import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { DesignTool } from "../../src/tool/design"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const baseCtx: Tool.Context = {
  sessionID: "test",
  messageID: "message",
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.design", () => {
  test("exposes authoring guidance when no design doc exists", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await DesignTool.init()
        expect(tool.description).toContain("Use action=guidance before creating a new DESIGN.md")

        const result = await tool.execute({ action: "guidance" }, baseCtx)
        expect(result.title).toBe("DESIGN.md authoring guidance")
        expect(result.output).toContain("<design_authoring_guidance>")
        expect(result.output).toContain("preserve unknown custom tokens")
        expect(result.output).toContain("unknown markdown sections")
      },
    })
  })

  test("loads design context with front matter and markdown body", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "DESIGN.md"),
          "---\ncolors:\n  brand: '#123456'\n---\n\n# Product Design\n\nUse crisp geometry.",
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await DesignTool.init()
        expect(tool.description).toContain(path.join(tmp.path, "DESIGN.md"))

        const result = await tool.execute({}, baseCtx)
        expect(result.title).toBe("Loaded design context")
        expect(result.metadata.paths).toEqual([path.join(tmp.path, "DESIGN.md")])
        expect(result.output).toContain("---\ncolors:\n  brand: '#123456'\n---")
        expect(result.output).toContain("# Product Design")
        expect(result.output).toContain("Use crisp geometry.")
      },
    })
  })

  test("loads an empty design doc when it exists", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await DesignTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("Loaded design context")
        expect(result.metadata.paths).toEqual([path.join(tmp.path, "DESIGN.md")])
        expect(result.output).toContain(`<design_doc priority="1" scope="nearest" path="${path.join(tmp.path, "DESIGN.md")}">`)
      },
    })
  })

  test("validates the nearest design doc through the design tool", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
      },
    })

    const originalPath = process.env.PATH
    process.env.PATH = ""
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await DesignTool.init()
          const result = await tool.execute({ action: "validate" }, baseCtx)

          expect(result.title).toBe("DESIGN.md validation unavailable")
          expect(result.metadata.paths).toEqual([path.join(tmp.path, "DESIGN.md")])
          expect(result.output).toContain("status=\"unavailable\"")
          expect(result.output).toContain("No compatible local DESIGN.md validator was found")
        },
      })
    } finally {
      process.env.PATH = originalPath
    }
  })

  test("validates an explicit in-project design doc path", async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ""
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "DESIGN.md"), "# Design")
      },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const filepath = path.join(tmp.path, "docs", "DESIGN.md")
          const tool = await DesignTool.init()
          const result = await tool.execute({ action: "validate", filePath: filepath }, baseCtx)

          expect(result.title).toBe("DESIGN.md validation unavailable")
          expect(result.metadata.paths).toEqual([filepath])
          expect(result.output).toContain("status=\"unavailable\"")
          expect(result.output).toContain("No compatible local DESIGN.md validator was found")
        },
      })
    } finally {
      process.env.PATH = originalPath
    }
  })

  test("skips manual validation for out-of-project design doc paths", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Outside Design")
      },
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const filepath = path.join(outside.path, "DESIGN.md")
        const tool = await DesignTool.init()
        const result = await tool.execute({ action: "validate", filePath: filepath }, baseCtx)

        expect(result.title).toBe("DESIGN.md validation skipped")
        expect(result.metadata.paths).toEqual([filepath])
        expect(result.metadata.status).toBe("error")
        expect(result.output).toContain("outside the current project/worktree scope")
        expect(result.output).not.toContain("No compatible local DESIGN.md validator was found")
      },
    })
  })

  test("skips validation for explicit non-design paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "README.md"), "# Readme")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await DesignTool.init()
        const result = await tool.execute({ action: "validate", filePath: path.join(tmp.path, "README.md") }, baseCtx)

        expect(result.title).toBe("DESIGN.md validation skipped")
        expect(result.metadata.status).toBe("error")
        expect(result.output).toContain("not a DESIGN.md/design.md file")
      },
    })
  })
})
