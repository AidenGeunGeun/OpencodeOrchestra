import { For, Match, Show, Switch, batch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import FileTree from "@/components/file-tree"
import SubagentList from "@/components/subagent-list"
import { BrowserTab } from "@/pages/session/browser-tab"
import { SecureEnvTab } from "@/pages/session/secure-env-tab"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSync } from "@/context/sync"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import {
  canHideToolDockTool,
  createOpenSessionFileTab,
  createSessionTabs,
  defaultHiddenToolDockTools,
  getTabReorderIndex,
  hiddenToolDockTools,
  nextVisibleToolDockTool,
  type SessionWorkspaceLayout,
  visibleToolDockTools,
  type Sizing,
  type ToolDockTool,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionSidePanel(props: {
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  sessionID?: string
  childCount: number
  workspaceLayout: () => SessionWorkspaceLayout
  onNavigateSession: (sessionID: string) => void
}) {
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const language = useLanguage()
  const platform = usePlatform()
  const command = useCommand()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const browserAvailable = createMemo(() => platform.platform === "desktop")
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop())
  const availableToolTabs = createMemo<ToolDockTool[]>(() => [
    ...(reviewTab() ? (["review"] as const) : []),
    ...(props.childCount > 0 ? (["subagents"] as const) : []),
    ...(browserAvailable() ? (["browser"] as const) : []),
    "secret" as const,
  ])
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    return `${props.workspaceLayout().sidePanelWidth}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${props.workspaceLayout().fileTreeWidth}px` : "0px"))

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const reviewEmptyKey = createMemo(() => {
    if (sync.project && !sync.project.vcs) return "session.review.noVcs"
    if (sync.data.config.snapshot === false) return "session.review.noSnapshot"
    return "session.review.noChanges"
  })

  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    hiddenTools: {} as Partial<Record<ToolDockTool, boolean>>,
    toolDockDefaultsApplied: false,
    toolDockDefaultMode: undefined as "fallback" | "subagents" | undefined,
    userCustomizedToolDock: false,
  })

  const hiddenToolTabs = createMemo(() =>
    hiddenToolDockTools(
      availableToolTabs(),
      (["review", "subagents", "browser", "secret"] as ToolDockTool[]).filter((tool) => store.hiddenTools[tool]),
    ),
  )
  const visibleToolTabs = createMemo(() => visibleToolDockTools(availableToolTabs(), hiddenToolTabs()))
  const isToolVisible = (tool: ToolDockTool) => visibleToolTabs().includes(tool)
  const canHideTool = (tool: ToolDockTool) => canHideToolDockTool(availableToolTabs(), hiddenToolTabs(), tool)

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: () => reviewTab() && isToolVisible("review"),
    hasReview: () => hasReview() || visibleToolTabs().length === 1,
    extras: createMemo(() => visibleToolTabs().filter((tool) => tool !== "review")),
    reserved: createMemo(() => availableToolTabs().filter((tool) => tool !== "review")),
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const browserRuntimeKey = createMemo(() =>
    reviewOpen() && activeTab() === "browser" && isToolVisible("browser") ? (params.dir ?? "") : "",
  )

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const toolLabel = (tool: ToolDockTool) => {
    if (tool === "review") return language.t("session.tab.review")
    if (tool === "subagents") return "Subagents"
    if (tool === "secret") return language.t("session.tab.secureEnv")
    return "Browser"
  }
  const hideToolTitle = (tool: ToolDockTool) =>
    canHideTool(tool)
      ? language.t("session.toolDock.hideTool", { tool: toolLabel(tool) })
      : language.t("session.toolDock.keepOneToolVisible")
  const hideTool = (tool: ToolDockTool) => {
    if (!canHideTool(tool)) return

    const nextHidden = [...hiddenToolTabs(), tool]
    const fallback = nextVisibleToolDockTool(availableToolTabs(), nextHidden, tool)
    batch(() => {
      setStore("userCustomizedToolDock", true)
      setStore("hiddenTools", tool, true)
      if (activeTab() === tool && fallback) tabs().setActive(fallback)
    })
  }
  const restoreTool = (tool: ToolDockTool) => {
    batch(() => {
      setStore("userCustomizedToolDock", true)
      setStore("hiddenTools", tool, false)
    })
    queueMicrotask(() => tabs().setActive(tool))
  }
  const toolCloseButton = (tool: ToolDockTool) => (
    <Tooltip value={hideToolTitle(tool)} placement="bottom" gutter={10}>
      <IconButton
        icon="close-small"
        variant="ghost"
        class="h-5 w-5"
        disabled={!canHideTool(tool)}
        onClick={(event) => {
          event.stopPropagation()
          hideTool(tool)
        }}
        aria-label={hideToolTitle(tool)}
      />
    </Tooltip>
  )

  createEffect(() => {
    if (!reviewOpen()) return

    const available = availableToolTabs()
    if (available.length === 0) return
    if (store.userCustomizedToolDock) return

    const subagentsAvailable = available.includes("subagents")
    const hidden = new Set(defaultHiddenToolDockTools(available))
    const alreadyDefault = (["review", "subagents", "browser", "secret"] as ToolDockTool[]).every(
      (tool) => Boolean(store.hiddenTools[tool]) === hidden.has(tool),
    )

    if (subagentsAvailable && store.toolDockDefaultMode === "subagents" && alreadyDefault) return
    if (!subagentsAvailable && store.toolDockDefaultsApplied) return

    batch(() => {
      for (const tool of ["review", "subagents", "browser", "secret"] as ToolDockTool[]) {
        setStore("hiddenTools", tool, hidden.has(tool))
      }
      setStore("toolDockDefaultsApplied", true)
      setStore("toolDockDefaultMode", subagentsAvailable ? "subagents" : "fallback")
      if (subagentsAvailable) {
        tabs().setActive("subagents")
      }
    })
  })

  createEffect(() => {
    if (!reviewOpen()) return

    const fallback = availableToolTabs()[0]
    if (!fallback || visibleToolTabs().length > 0) return
    setStore("hiddenTools", fallback, false)
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: panelWidth() }}
      >
        <div
          class="size-full flex border-l border-border-weaker-base transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          classList={{
            "opacity-0 translate-x-2": !open(),
            "opacity-100 translate-x-0 delay-75": open(),
          }}
        >
          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !reviewOpen(),
            }}
          >
            <div class="size-full min-w-0 h-full bg-background-base">
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragYAxis />
                <Tabs value={activeTab()} onChange={openTab}>
                  <div class="sticky top-0 shrink-0 flex">
                    <Tabs.List
                      ref={(el: HTMLDivElement) => {
                        const stop = createFileTabListSync({ el, contextOpen })
                        onCleanup(stop)
                      }}
                    >
                      <Show when={isToolVisible("review")}>
                        <Tabs.Trigger value="review" closeButton={toolCloseButton("review")}>
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.review")}</div>
                            <Show when={hasReview()}>
                              <div>{reviewCount()}</div>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={contextOpen()}>
                        <Tabs.Trigger
                          value="context"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={() => tabs().close("context")}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onMiddleClick={() => tabs().close("context")}
                        >
                          <div class="flex items-center gap-2">
                            <SessionContextUsage variant="indicator" />
                            <div>{language.t("session.tab.context")}</div>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={isToolVisible("subagents")}>
                        <Tabs.Trigger value="subagents" closeButton={toolCloseButton("subagents")}>
                          <div class="flex items-center gap-1.5">
                            <div>Subagents</div>
                            <div>{props.childCount}</div>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={isToolVisible("browser")}>
                        <Tabs.Trigger value="browser" closeButton={toolCloseButton("browser")}>
                          <div>Browser</div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={isToolVisible("secret")}>
                        <Tabs.Trigger value="secret" closeButton={toolCloseButton("secret")}>
                          <div>{language.t("session.tab.secureEnv")}</div>
                        </Tabs.Trigger>
                      </Show>
                      <SortableProvider ids={openedTabs()}>
                        <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                      </SortableProvider>
                      <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                        <DropdownMenu gutter={4} placement="bottom-end">
                          <Tooltip
                            value={language.t(
                              hiddenToolTabs().length > 0
                                ? "session.toolDock.restoreHiddenTool"
                                : "session.toolDock.noHiddenTools",
                            )}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="plus-small"
                              variant="ghost"
                              iconSize="large"
                              class="!rounded-md"
                              disabled={hiddenToolTabs().length === 0}
                              aria-label={language.t("session.toolDock.restoreHiddenTab")}
                            />
                          </Tooltip>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content>
                              <DropdownMenu.Group>
                                <DropdownMenu.GroupLabel>
                                  {language.t("session.toolDock.hiddenTools")}
                                </DropdownMenu.GroupLabel>
                                <For each={hiddenToolTabs()}>
                                  {(tool) => (
                                    <DropdownMenu.Item onSelect={() => restoreTool(tool)}>
                                      <DropdownMenu.ItemLabel>{toolLabel(tool)}</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                  )}
                                </For>
                              </DropdownMenu.Group>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </Tabs.List>
                  </div>

                  <Show when={reviewTab()}>
                    <Tabs.Content
                      value="review"
                      data-tool-dock-content="review"
                      class="flex flex-col h-full overflow-hidden contain-strict"
                      forceMount
                      hidden={activeTab() !== "review"}
                    >
                      {props.reviewPanel()}
                    </Tabs.Content>
                  </Show>

                  <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "empty"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                          <Mark class="w-14 opacity-10" />
                          <div class="text-14-regular text-text-weak max-w-56">
                            {language.t("session.files.selectToOpen")}
                          </div>
                        </div>
                      </div>
                    </Show>
                  </Tabs.Content>

                  <Show when={contextOpen()}>
                    <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "context"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                          <SessionContextTab />
                        </div>
                      </Show>
                    </Tabs.Content>
                  </Show>

                  <Show when={props.childCount > 0 && props.sessionID}>
                    <Tabs.Content
                      value="subagents"
                      data-tool-dock-content="subagents"
                      class="flex flex-col h-full overflow-hidden contain-strict"
                      forceMount
                      hidden={activeTab() !== "subagents"}
                    >
                      <Show when={activeTab() === "subagents"}>
                        <SubagentList sessionID={props.sessionID!} onNavigateSession={props.onNavigateSession} />
                      </Show>
                    </Tabs.Content>
                  </Show>

                  <Show when={browserAvailable()}>
                    <Tabs.Content
                      value="browser"
                      data-tool-dock-content="browser"
                      class="flex flex-col h-full overflow-hidden contain-strict"
                      forceMount
                      hidden={activeTab() !== "browser"}
                    >
                      <Show when={browserRuntimeKey()} keyed>
                        {(_) => <BrowserTab />}
                      </Show>
                    </Tabs.Content>
                  </Show>

                  <Tabs.Content
                    value="secret"
                    data-tool-dock-content="secret"
                    class="flex flex-col h-full overflow-hidden contain-strict"
                    forceMount
                    hidden={activeTab() !== "secret"}
                  >
                    <Show when={activeTab() === "secret"}>
                      <SecureEnvTab />
                    </Show>
                  </Tabs.Content>

                  <Show when={activeFileTab()} keyed>
                    {(tab) => <FileTabContent tab={tab} />}
                  </Show>
                </Tabs>
                <DragOverlay>
                  <Show when={store.activeDraggable} keyed>
                    {(tab) => {
                      const path = file.pathFromTab(tab)
                      return (
                        <div data-component="tabs-drag-preview">
                          <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                        </div>
                      )
                    }}
                  </Show>
                </DragOverlay>
              </DragDropProvider>
            </div>
          </div>

          <div
            id="file-tree-panel"
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weaker-base": reviewOpen() }}
            >
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {reviewCount()}{" "}
                    {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={hasReview()}>
                      <Show
                        when={diffsReady()}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {language.t("common.loading")}
                            {language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <FileTree
                          path=""
                          class="pt-3"
                          allowed={diffFiles()}
                          kinds={kinds()}
                          draggable={false}
                          active={props.activeDiff}
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>
                      {empty(
                        language.t(sync.project && !sync.project.vcs ? "session.review.noChanges" : reviewEmptyKey()),
                      )}
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                    <Match when={true}>
                      <FileTree
                        path=""
                        class="pt-3"
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => openTab(file.tab(node.path))}
                      />
                    </Match>
                  </Switch>
                </Tabs.Content>
              </Tabs>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={props.workspaceLayout().fileTreeWidth}
                  min={props.workspaceLayout().fileTreeResizeMin}
                  max={props.workspaceLayout().fileTreeResizeMax}
                  collapseThreshold={160}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                  onCollapse={layout.fileTree.close}
                />
              </div>
            </Show>
          </div>
        </div>
      </aside>
    </Show>
  )
}
