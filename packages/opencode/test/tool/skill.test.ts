import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import type { PermissionNext } from "../../src/permission/next"
import type { Tool } from "../../src/tool/tool"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { tmpdir } from "../fixture/fixture"

const hasConfigDirectories = typeof (Config as any).directories === "function"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("tool.skill", () => {
  test.skipIf(!hasConfigDirectories)("description lists skill location URL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".oco", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill
`,
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const skillPath = path.join(tmp.path, ".oco", "skill", "tool-skill", "SKILL.md")
          expect(tool.description).toContain(`<location>${pathToFileURL(skillPath).href}</location>`)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test.skipIf(!hasConfigDirectories)("execute returns skill content block with files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".oco", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
        )
        await Bun.write(path.join(skillDir, "scripts", "demo.txt"), "demo")
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async (req) => {
              requests.push(req)
            },
          }

          const result = await tool.execute({ name: "tool-skill" }, ctx)
          const dir = path.join(tmp.path, ".oco", "skill", "tool-skill")
          const file = path.resolve(dir, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")

          expect(result.metadata.dir).toBe(dir)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(dir).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test.skipIf(!hasConfigDirectories)("execute loads bundled skill resource by relative path", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".oco", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for resource tests.
---

# Tool Skill

See references/guide.md.
`,
        )
        await Bun.write(path.join(skillDir, "references", "guide.md"), "# Guide\n\nBundled reference.")
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async (req) => {
              requests.push(req)
            },
          }

          const result = await tool.execute({ name: "tool-skill", resource: "references/guide.md" }, ctx)

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(result.title).toBe("Loaded skill resource: tool-skill/references/guide.md")
          expect(result.output).toContain('<skill_resource name="tool-skill" path="references/guide.md">')
          expect(result.output).toContain("Bundled reference.")
          expect(result.metadata.resource).toBe("references/guide.md")
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test.skipIf(!hasConfigDirectories)("execute rejects resource paths outside skill directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".oco", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for resource tests.
---

# Tool Skill
`,
        )
        await Bun.write(path.join(dir, ".oco", "secret.txt"), "nope")
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async () => {},
          }

          await expect(tool.execute({ name: "tool-skill", resource: "../secret.txt" }, ctx)).rejects.toThrow(
            "escapes skill directory",
          )
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test.skipIf(!hasConfigDirectories)("execute rejects symlinked resources outside skill directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".oco", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for symlink resource tests.
---

# Tool Skill
`,
        )
        const secretPath = path.join(dir, ".oco", "secret.txt")
        await Bun.write(secretPath, "nope")
        await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
        await fs.symlink(secretPath, path.join(skillDir, "references", "secret-link.md"))
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await SkillTool.init()
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async () => {},
          }

          await expect(tool.execute({ name: "tool-skill", resource: "references/secret-link.md" }, ctx)).rejects.toThrow(
            "escapes skill directory",
          )
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
