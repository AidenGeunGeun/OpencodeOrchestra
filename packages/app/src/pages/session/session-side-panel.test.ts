import { describe, expect, test } from "bun:test"

describe("SessionSidePanel Tool Dock restore", () => {
  test("focuses a restored hidden tool after it becomes visible", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const restoreTool = (tool: ToolDockTool) =>")
    expect(source).toContain('setStore("hiddenTools", tool, false)')
    expect(source).toContain("queueMicrotask(() => tabs().setActive(tool))")
  })
})
