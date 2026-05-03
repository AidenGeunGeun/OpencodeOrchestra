import { describe, expect, test } from "bun:test"

describe("SessionSidePanel Tool Dock restore", () => {
  test("focuses a restored hidden tool after it becomes visible", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const restoreTool = (tool: ToolDockTool) =>")
    expect(source).toContain('setStore("hiddenTools", tool, false)')
    expect(source).toContain("queueMicrotask(() => tabs().setActive(tool))")
  })

  test("mounts the browser runtime only while the browser tool is active in the current project", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const browserRuntimeKey = createMemo")
    expect(source).toContain("reviewOpen() && activeTab()")
    expect(source).toContain('activeTab() === "browser" && isToolVisible("browser")')
    expect(source).toContain('params.dir ?? ""')
    expect(source).toContain("<Show when={browserRuntimeKey()} keyed>")
    expect(source).not.toContain("browserActivated")
  })
})
