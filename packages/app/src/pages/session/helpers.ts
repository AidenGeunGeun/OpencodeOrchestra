import { batch, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { same } from "@/utils/same"

const emptyTabs: string[] = []
export const SESSION_PANEL_MIN_WIDTH = 450
export const TOOL_DOCK_MIN_WIDTH = 360
export const FILE_TREE_MIN_WIDTH = 200
export const FILE_TREE_MAX_WIDTH = 480

export type ToolDockTool = "review" | "subagents" | "browser"

type Tabs = {
  active: Accessor<string | undefined>
  all: Accessor<string[]>
}

type TabsInput = {
  tabs: Accessor<Tabs>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
  extras?: Accessor<string[]>
  reserved?: Accessor<string[]>
}

export const getSessionKey = (dir: string | undefined, id: string | undefined) => `${dir ?? ""}${id ? `/${id}` : ""}`

export const createSessionTabs = (input: TabsInput) => {
  const review = input.review ?? (() => false)
  const hasReview = input.hasReview ?? (() => false)
  const extras = input.extras ?? (() => emptyTabs)
  const reserved = input.reserved ?? extras
  const contextOpen = createMemo(() => input.tabs().active() === "context" || input.tabs().all().includes("context"))
  const openedTabs = createMemo(
    () => {
      const seen = new Set<string>()
      return input
        .tabs()
        .all()
        .flatMap((tab) => {
          if (tab === "context" || tab === "review") return []
          if (reserved().includes(tab)) return []
          const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
          if (seen.has(value)) return []
          seen.add(value)
          return [value]
        })
    },
    emptyTabs,
    { equals: same },
  )
  const activeTab = createMemo(() => {
    const active = input.tabs().active()
    if (active === "context") return active
    if (active === "review" && review()) return active
    if (active && extras().includes(active)) return active
    if (active && input.pathFromTab(active)) return input.normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (review() && hasReview()) return "review"
    const extra = extras()[0]
    if (extra) return extra
    return "empty"
  })
  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })
  const closableTab = createMemo(() => {
    const active = activeTab()
    if (active === "context") return active
    if (!openedTabs().includes(active)) return
    return active
  })

  return {
    contextOpen,
    openedTabs,
    activeTab,
    activeFileTab,
    closableTab,
  }
}

export const visibleToolDockTools = (
  available: readonly ToolDockTool[],
  hidden: readonly ToolDockTool[],
): ToolDockTool[] => {
  const hiddenSet = new Set(hidden)
  return available.filter((tool) => !hiddenSet.has(tool))
}

export const hiddenToolDockTools = (
  available: readonly ToolDockTool[],
  hidden: readonly ToolDockTool[],
): ToolDockTool[] => {
  const availableSet = new Set(available)
  return hidden.filter((tool) => availableSet.has(tool))
}

export const canHideToolDockTool = (
  available: readonly ToolDockTool[],
  hidden: readonly ToolDockTool[],
  tool: ToolDockTool,
): boolean => {
  const visible = visibleToolDockTools(available, hidden)
  return visible.includes(tool) && visible.length > 1
}

export const nextVisibleToolDockTool = (
  available: readonly ToolDockTool[],
  hidden: readonly ToolDockTool[],
  current?: ToolDockTool,
): ToolDockTool | undefined => visibleToolDockTools(available, hidden).find((tool) => tool !== current)

export const defaultHiddenToolDockTools = (available: readonly ToolDockTool[]): ToolDockTool[] => {
  const preferred = available.includes("subagents") ? "subagents" : available[0]
  if (!preferred) return []
  return available.filter((tool) => tool !== preferred)
}

export const getSessionPanelResizeMax = (availableWidth: number, reservedSidePanelWidth = 0) =>
  Math.max(SESSION_PANEL_MIN_WIDTH, availableWidth - reservedSidePanelWidth - TOOL_DOCK_MIN_WIDTH)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const cleanWidth = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

const fileTreeResizeBounds = (max: number) => {
  const fileTreeResizeMax = cleanWidth(max)
  return {
    fileTreeResizeMin: Math.min(FILE_TREE_MIN_WIDTH, fileTreeResizeMax),
    fileTreeResizeMax,
  }
}

export type SessionWorkspaceLayout = {
  sessionWidth: number
  sidePanelWidth: number
  toolDockWidth: number
  fileTreeWidth: number
  sessionResizeMax: number
  fileTreeResizeMin: number
  fileTreeResizeMax: number
}

export const getSessionWorkspaceLayout = (input: {
  availableWidth: number
  toolDockOpen: boolean
  fileTreeOpen: boolean
  preferredSessionWidth: number
  preferredFileTreeWidth: number
}): SessionWorkspaceLayout => {
  const availableWidth = cleanWidth(input.availableWidth)
  const sessionMin = Math.min(SESSION_PANEL_MIN_WIDTH, availableWidth)
  const preferredSessionWidth = cleanWidth(input.preferredSessionWidth)
  const preferredFileTreeWidth = clamp(
    cleanWidth(input.preferredFileTreeWidth),
    FILE_TREE_MIN_WIDTH,
    FILE_TREE_MAX_WIDTH,
  )

  if (!input.toolDockOpen && !input.fileTreeOpen) {
    const fileTree = fileTreeResizeBounds(FILE_TREE_MAX_WIDTH)
    return {
      sessionWidth: availableWidth,
      sidePanelWidth: 0,
      toolDockWidth: 0,
      fileTreeWidth: 0,
      sessionResizeMax: Math.max(sessionMin, availableWidth),
      fileTreeResizeMin: fileTree.fileTreeResizeMin,
      fileTreeResizeMax: fileTree.fileTreeResizeMax,
    }
  }

  if (!input.toolDockOpen) {
    const fileTreeMax = Math.min(FILE_TREE_MAX_WIDTH, Math.max(0, availableWidth - sessionMin))
    const fileTree = fileTreeResizeBounds(fileTreeMax)
    const fileTreeWidth = input.fileTreeOpen
      ? availableWidth >= SESSION_PANEL_MIN_WIDTH + FILE_TREE_MIN_WIDTH
        ? clamp(preferredFileTreeWidth, FILE_TREE_MIN_WIDTH, fileTreeMax)
        : fileTreeMax
      : 0
    const sessionWidth = Math.max(0, availableWidth - fileTreeWidth)

    return {
      sessionWidth,
      sidePanelWidth: fileTreeWidth,
      toolDockWidth: 0,
      fileTreeWidth,
      sessionResizeMax: Math.max(SESSION_PANEL_MIN_WIDTH, sessionWidth),
      fileTreeResizeMin: fileTree.fileTreeResizeMin,
      fileTreeResizeMax: fileTree.fileTreeResizeMax,
    }
  }

  const sidePanelMinimum = TOOL_DOCK_MIN_WIDTH + (input.fileTreeOpen ? FILE_TREE_MIN_WIDTH : 0)
  const sessionResizeMax = Math.max(sessionMin, availableWidth - sidePanelMinimum)
  const sessionWidth = clamp(preferredSessionWidth, sessionMin, sessionResizeMax)
  const sidePanelWidth = Math.max(0, availableWidth - sessionWidth)

  if (!input.fileTreeOpen) {
    const fileTree = fileTreeResizeBounds(FILE_TREE_MAX_WIDTH)
    return {
      sessionWidth,
      sidePanelWidth,
      toolDockWidth: sidePanelWidth,
      fileTreeWidth: 0,
      sessionResizeMax,
      fileTreeResizeMin: fileTree.fileTreeResizeMin,
      fileTreeResizeMax: fileTree.fileTreeResizeMax,
    }
  }

  const sidePanelCanFitMinimums = sidePanelWidth >= TOOL_DOCK_MIN_WIDTH + FILE_TREE_MIN_WIDTH
  const fileTreeWidth = sidePanelCanFitMinimums
    ? clamp(
        preferredFileTreeWidth,
        FILE_TREE_MIN_WIDTH,
        Math.min(FILE_TREE_MAX_WIDTH, sidePanelWidth - TOOL_DOCK_MIN_WIDTH),
      )
    : Math.round(sidePanelWidth * (FILE_TREE_MIN_WIDTH / (TOOL_DOCK_MIN_WIDTH + FILE_TREE_MIN_WIDTH)))
  const toolDockWidth = Math.max(0, sidePanelWidth - fileTreeWidth)
  const fileTree = fileTreeResizeBounds(
    Math.min(
      FILE_TREE_MAX_WIDTH,
      sidePanelCanFitMinimums ? sidePanelWidth - TOOL_DOCK_MIN_WIDTH : sidePanelWidth,
    ),
  )

  return {
    sessionWidth,
    sidePanelWidth,
    toolDockWidth,
    fileTreeWidth,
    sessionResizeMax,
    fileTreeResizeMin: fileTree.fileTreeResizeMin,
    fileTreeResizeMax: fileTree.fileTreeResizeMax,
  }
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)
    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) return

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    onCleanup(() => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
    })
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>
