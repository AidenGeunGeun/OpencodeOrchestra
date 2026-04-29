import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createOpenReviewFile,
  createOpenSessionFileTab,
  createSessionTabs,
  canHideToolDockTool,
  defaultHiddenToolDockTools,
  FILE_TREE_MAX_WIDTH,
  FILE_TREE_MIN_WIDTH,
  focusTerminalById,
  getTabReorderIndex,
  getSessionPanelResizeMax,
  getSessionWorkspaceLayout,
  hiddenToolDockTools,
  nextVisibleToolDockTool,
  SESSION_PANEL_MIN_WIDTH,
  TOOL_DOCK_MIN_WIDTH,
  visibleToolDockTools,
} from "./helpers"

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      setActive: (tab) => calls.push(`active:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts", "active:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("createSessionTabs", () => {
  test("normalizes the effective file tab", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["file://src/a.ts", "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
      })

      expect(result.activeTab()).toBe("norm:src/a.ts")
      expect(result.activeFileTab()).toBe("norm:src/a.ts")
      expect(result.closableTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })

  test("prefers context and review fallbacks when no file tab is active", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("context")
      expect(result.closableTab()).toBe("context")
      dispose()
    })

    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("review")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })

  test("keeps reserved hidden tool ids out of file tabs", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: "browser" as string | undefined,
        all: ["browser", "file://src/a.ts"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
        extras: () => [],
        reserved: () => ["browser", "subagents"],
      })

      expect(result.openedTabs()).toEqual(["norm:src/a.ts"])
      expect(result.activeTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })
})

describe("Tool Dock tab visibility", () => {
  const available = ["review", "subagents", "browser"] as const

  test("filters visible and restorable tools", () => {
    expect(visibleToolDockTools(available, ["browser"])).toEqual(["review", "subagents"])
    expect(hiddenToolDockTools(available, ["browser", "subagents"])).toEqual(["browser", "subagents"])
    expect(hiddenToolDockTools(["review", "browser"], ["subagents", "browser"])).toEqual(["browser"])
  })

  test("protects the last visible tool", () => {
    expect(canHideToolDockTool(available, [], "review")).toBe(true)
    expect(canHideToolDockTool(available, ["review", "subagents"], "browser")).toBe(false)
    expect(canHideToolDockTool(available, ["review"], "review")).toBe(false)
  })

  test("chooses a visible fallback after hiding the active tool", () => {
    expect(nextVisibleToolDockTool(available, ["browser"], "browser")).toBe("review")
    expect(nextVisibleToolDockTool(["browser"], ["browser"], "browser")).toBeUndefined()
  })

  test("defaults the Tool Dock to subagents when available", () => {
    expect(defaultHiddenToolDockTools(available)).toEqual(["review", "browser"])
    expect(defaultHiddenToolDockTools(["review", "browser"])).toEqual(["browser"])
    expect(defaultHiddenToolDockTools(["review", "browser", "subagents"])).toEqual(["review", "browser"])
    expect(defaultHiddenToolDockTools(["browser"])).toEqual([])
  })
})

describe("Tool Dock sizing", () => {
  test("lets the conversation expand while keeping a compact dock", () => {
    expect(getSessionPanelResizeMax(1600)).toBe(1600 - TOOL_DOCK_MIN_WIDTH)
    expect(getSessionPanelResizeMax(3000)).toBe(3000 - TOOL_DOCK_MIN_WIDTH)
  })

  test("reserves file tree width before preserving the dock minimum", () => {
    expect(getSessionPanelResizeMax(1600, 344)).toBe(1600 - 344 - TOOL_DOCK_MIN_WIDTH)
  })

  test("never sets the resize max below the conversation minimum", () => {
    expect(getSessionPanelResizeMax(768)).toBe(SESSION_PANEL_MIN_WIDTH)
  })

  test("clamps an oversized saved conversation width before rendering the Tool Dock", () => {
    expect(
      getSessionWorkspaceLayout({
        availableWidth: 1200,
        toolDockOpen: true,
        fileTreeOpen: false,
        preferredSessionWidth: 1800,
        preferredFileTreeWidth: 344,
      }),
    ).toMatchObject({
      sessionWidth: 1200 - TOOL_DOCK_MIN_WIDTH,
      toolDockWidth: TOOL_DOCK_MIN_WIDTH,
      sidePanelWidth: TOOL_DOCK_MIN_WIDTH,
      fileTreeWidth: 0,
    })
  })

  test("keeps file tree and Tool Dock inside the current workspace", () => {
    const layout = getSessionWorkspaceLayout({
      availableWidth: 1010,
      toolDockOpen: true,
      fileTreeOpen: true,
      preferredSessionWidth: 1200,
      preferredFileTreeWidth: FILE_TREE_MAX_WIDTH,
    })

    expect(layout.sessionWidth).toBe(SESSION_PANEL_MIN_WIDTH)
    expect(layout.toolDockWidth).toBe(TOOL_DOCK_MIN_WIDTH)
    expect(layout.fileTreeWidth).toBe(1010 - SESSION_PANEL_MIN_WIDTH - TOOL_DOCK_MIN_WIDTH)
    expect(layout.sessionWidth + layout.toolDockWidth + layout.fileTreeWidth).toBe(1010)
  })

  test("uses a deterministic compact fallback when normal desktop minimums do not fit", () => {
    const layout = getSessionWorkspaceLayout({
      availableWidth: 768,
      toolDockOpen: true,
      fileTreeOpen: true,
      preferredSessionWidth: 1600,
      preferredFileTreeWidth: FILE_TREE_MAX_WIDTH,
    })

    expect(layout.sessionWidth).toBe(SESSION_PANEL_MIN_WIDTH)
    expect(layout.toolDockWidth).toBeGreaterThan(0)
    expect(layout.fileTreeWidth).toBeGreaterThanOrEqual(0)
    expect(layout.sessionWidth + layout.toolDockWidth + layout.fileTreeWidth).toBe(768)
  })

  test("does not let oversized file tree preferences starve the session when Tool Dock is closed", () => {
    const layout = getSessionWorkspaceLayout({
      availableWidth: 700,
      toolDockOpen: false,
      fileTreeOpen: true,
      preferredSessionWidth: 600,
      preferredFileTreeWidth: 2000,
    })

    expect(layout.sessionWidth).toBe(SESSION_PANEL_MIN_WIDTH)
    expect(layout.fileTreeWidth).toBe(700 - SESSION_PANEL_MIN_WIDTH)
    expect(layout.fileTreeResizeMin).toBe(FILE_TREE_MIN_WIDTH)
    expect(layout.fileTreeResizeMax).toBe(700 - SESSION_PANEL_MIN_WIDTH)
  })
})
