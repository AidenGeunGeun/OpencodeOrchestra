import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { InternalPath } from "../../src/security/internal-path"
import { BashTool } from "../../src/tool/bash"
import { GlobTool } from "../../src/tool/glob"
import { GrepTool } from "../../src/tool/grep"
import { ReadTool } from "../../src/tool/read"
import { WriteTool } from "../../src/tool/write"
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

describe("internal path policy", () => {
  test("allows normal OCO config, skill, and database paths", () => {
    const allowed = [
      Global.Path.config,
      path.join(Global.Path.config, "oco.jsonc"),
      path.join(Global.Path.config, "skills", "example", "SKILL.md"),
      path.join(Global.Path.config, "skill", "example", "SKILL.md"),
      path.join(Global.Path.cache, "skills", "remote", "SKILL.md"),
      path.join(Global.Path.data, "oco.db"),
      path.join(Global.Path.legacy.config, "opencode.jsonc"),
      path.join(Global.Path.legacy.data, "opencode.db"),
    ]

    for (const item of allowed) {
      expect(InternalPath.contains(item), item).toBe(false)
      expect(() => InternalPath.assertAllowed(item)).not.toThrow()
    }
  })

  test("denies direct secret files", () => {
    const denied = [
      path.join(Global.Path.data, "auth.json"),
      path.join(Global.Path.data, "mcp-auth.json"),
      path.join(Global.Path.data, "secret-vault.key"),
      path.join(Global.Path.legacy.data, "auth.json"),
      path.join(Global.Path.legacy.data, "mcp-auth.json"),
      path.join(Global.Path.legacy.data, "secret-vault.key"),
    ]

    for (const item of denied) {
      expect(InternalPath.contains(item), item).toBe(true)
      expect(() => InternalPath.assertAllowed(item)).toThrow("Access denied")
    }
  })

  test("denies raw private data directories", () => {
    const denied = [
      path.join(Global.Path.data, "storage"),
      path.join(Global.Path.data, "tool-output"),
      path.join(Global.Path.data, "snapshot"),
      path.join(Global.Path.data, "worktree"),
      path.join(Global.Path.legacy.data, "storage"),
    ]

    for (const item of denied) {
      expect(InternalPath.contains(item), item).toBe(true)
      expect(InternalPath.contains(path.join(item, "child.json")), item).toBe(true)
      expect(InternalPath.contains(path.join(item, "..leak")), item).toBe(true)
      expect(() => InternalPath.assertAllowed(item)).toThrow("Access denied")
    }
  })

  test("does not block allowed parents solely because they contain protected children", () => {
    expect(InternalPath.overlaps(Global.Path.data)).toBe(false)
    expect(InternalPath.overlaps(Global.Path.config)).toBe(false)
    expect(InternalPath.overlaps(path.join(Global.Path.data, "storage"))).toBe(true)
  })
})

describe("internal path tool boundary", () => {
  test("file tools can author and inspect global OCO skills and config", async () => {
    const id = `__oco_internal_path_test_${process.pid}_${Date.now()}`
    const skillDir = path.join(Global.Path.config, "skills", id)
    const skillPath = path.join(skillDir, "SKILL.md")
    const configPath = path.join(Global.Path.config, `${id}.json`)

    try {
      await fs.mkdir(skillDir, { recursive: true })
      await Bun.write(configPath, '{"pathGuardTest":true}\n')

      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          const read = await ReadTool.init()
          const grep = await GrepTool.init()
          const glob = await GlobTool.init()

          await write.execute(
            {
              filePath: skillPath,
              content: "---\nname: path-guard-test\ndescription: Path guard test skill\n---\n\nunique-skill-token\n",
            },
            ctx,
          )

          const config = await read.execute({ filePath: configPath }, ctx)
          expect(config.output).toContain("pathGuardTest")

          const skill = await read.execute({ filePath: skillPath }, ctx)
          expect(skill.output).toContain("unique-skill-token")

          const search = await grep.execute({ path: skillDir, pattern: "unique-skill-token" }, ctx)
          expect(search.output).toContain("SKILL.md")

          const files = await glob.execute({ path: skillDir, pattern: "SKILL.md" }, ctx)
          expect(files.output).toContain(skillPath)
        },
      })
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true })
      await fs.rm(configPath, { force: true })
    }
  }, 20_000)

  test("file tools deny direct secrets and raw private data", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const grep = await GrepTool.init()

        await expect(read.execute({ filePath: path.join(Global.Path.data, "auth.json") }, ctx)).rejects.toThrow(
          "Access denied",
        )
        await expect(grep.execute({ path: path.join(Global.Path.data, "storage"), pattern: "secret" }, ctx)).rejects.toThrow(
          "Access denied",
        )
      },
    })
  })

  test("write and bash checks deny dangling symlinks into protected paths", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(Global.Path.data, "storage", `dangling-${process.pid}-${Date.now()}.txt`)
    const link = path.join(tmp.path, "dangling-protected-link.txt")

    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rm(target, { force: true })
      await fs.symlink(target, link)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(InternalPath.contains(link)).toBe(true)

          const write = await WriteTool.init()
          await expect(write.execute({ filePath: link, content: "should not write" }, ctx)).rejects.toThrow("Access denied")

          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: `touch "${link}"`,
                description: "Touch protected symlink",
              },
              ctx,
            ),
          ).rejects.toThrow("Access denied")

          expect(await Bun.file(target).exists()).toBe(false)
        },
      })
    } finally {
      await fs.rm(link, { force: true })
      await fs.rm(target, { force: true })
    }
  })

  test("read and bash checks deny symlinks located inside protected directories", async () => {
    await using tmp = await tmpdir({ git: true })
    const storageDir = path.join(Global.Path.data, "storage")
    const outside = path.join(tmp.path, "outside-target.txt")
    const link = path.join(storageDir, `link-out-${process.pid}-${Date.now()}.txt`)

    try {
      await fs.mkdir(storageDir, { recursive: true })
      await Bun.write(outside, "outside")
      await fs.symlink(outside, link)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(InternalPath.contains(link)).toBe(true)

          const read = await ReadTool.init()
          await expect(read.execute({ filePath: link }, ctx)).rejects.toThrow("Access denied")

          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: `cat "${link}"`,
                description: "Read protected source symlink",
              },
              ctx,
            ),
          ).rejects.toThrow("Access denied")
        },
      })
    } finally {
      await fs.rm(link, { force: true })
    }
  })

  test("bash path checks allow normal config paths and deny direct secrets", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: `cat "${path.join(Global.Path.config, "oco.jsonc")}"`,
            description: "Read OCO config path",
          },
          ctx,
        )
        expect(typeof result.metadata.exit).toBe("number")

        await expect(
          bash.execute(
            {
              command: `cat "${path.join(Global.Path.data, "secret-vault.key")}"`,
              description: "Read vault key path",
            },
            ctx,
          ),
        ).rejects.toThrow("Access denied")

        await expect(
          bash.execute(
            {
              command: `ls "${path.join(Global.Path.data, "storage")}"`,
              description: "List legacy storage path",
            },
            ctx,
          ),
        ).rejects.toThrow("Access denied")
      },
    })
  })
})
