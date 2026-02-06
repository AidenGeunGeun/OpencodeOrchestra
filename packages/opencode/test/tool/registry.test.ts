import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Agent } from "../../src/agent/agent"

const SLOW_TIMEOUT_MS = 30000

describe("tool.registry", () => {
  test("loads tools from .opencode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolDir = path.join(opencodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  }, SLOW_TIMEOUT_MS)

  test("loads tools from .opencode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  }, SLOW_TIMEOUT_MS)

  test("excludes project state tools for subagents", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const orchestrator = await Agent.get("orchestrator")
        expect(orchestrator).toBeDefined()

        const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5.3-codex" }, orchestrator)
        const ids = tools.map((tool) => tool.id)

        expect(ids).not.toContain("project_state_read")
        expect(ids).not.toContain("project_state_write")
      },
    })
  }, SLOW_TIMEOUT_MS)

  test("includes project state tools for PM agent", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pm = await Agent.get("build")
        expect(pm).toBeDefined()

        const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5.3-codex" }, pm)
        const ids = tools.map((tool) => tool.id)

        expect(ids).toContain("project_state_read")
        expect(ids).toContain("project_state_write")
      },
    })
  }, SLOW_TIMEOUT_MS)
})
