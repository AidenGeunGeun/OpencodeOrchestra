import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"
import { Instance } from "../../src/project/instance"
import { GlobTool } from "../../src/tool/glob"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function withFakeRipgrep<T>(script: string, fn: () => Promise<T>) {
  const original = Ripgrep.filepath
  ;(Ripgrep as unknown as { filepath: typeof Ripgrep.filepath }).filepath = async () => script
  try {
    return await fn()
  } finally {
    ;(Ripgrep as unknown as { filepath: typeof Ripgrep.filepath }).filepath = original
  }
}

async function writeSlowRipgrep(dir: string) {
  const script = path.join(dir, "rg-slow.sh")
  await Bun.write(script, '#!/bin/sh\ntrap "exit 143" TERM INT\nsleep 5\n')
  await fs.chmod(script, 0o755)
  return script
}

describe("tool.glob", () => {
  test("basic file match", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"))
        await Bun.write(path.join(dir, "src", "match.ts"), "export const value = 1")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const result = await glob.execute(
          {
            pattern: "src/**/*.ts",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("match.ts")
      },
    })
  })

  test("does not follow symlinked directories by default", async () => {
    await using target = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "linked.txt"), "linked-only")
      },
    })
    await using search = await tmpdir({
      init: async (dir) => {
        await fs.symlink(target.path, path.join(dir, "link"), "dir")
      },
    })

    await Instance.provide({
      directory: search.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const result = await glob.execute(
          {
            pattern: "**/*.txt",
            path: search.path,
          },
          ctx,
        )
        expect(result.metadata.count).toBe(0)
        expect(result.output).toBe("No files found")

        const followed = await glob.execute(
          {
            pattern: "**/*.txt",
            path: search.path,
            followSymlinks: true,
          },
          ctx,
        )
        expect(followed.metadata.count).toBe(1)
        expect(followed.output).toContain("linked.txt")
      },
    })
  })

  test("times out slow ripgrep searches with retry guidance", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => writeSlowRipgrep(dir),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        await withFakeRipgrep(tmp.extra, async () => {
          const started = Date.now()
          await expect(
            glob.execute(
              {
                pattern: "**/*",
                path: tmp.path,
                timeout: 0.05,
              },
              ctx,
            ),
          ).rejects.toThrow(/glob search timed out.*narrower path.*specific glob pattern/s)
          expect(Date.now() - started).toBeLessThan(1000)
        })
      },
    })
  })

  test("reports user cancellation separately from timeout", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => writeSlowRipgrep(dir),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const controller = new AbortController()
        const cancelCtx = { ...ctx, abort: controller.signal }
        const cancel = setTimeout(() => controller.abort(), 20)
        try {
          await withFakeRipgrep(tmp.extra, async () => {
            await expect(
              glob.execute(
                {
                  pattern: "**/*",
                  path: tmp.path,
                  timeout: 1,
                },
                cancelCtx,
              ),
            ).rejects.toThrow("glob search was cancelled before it completed")
          })
        } finally {
          clearTimeout(cancel)
        }
      },
    })
  })
})
