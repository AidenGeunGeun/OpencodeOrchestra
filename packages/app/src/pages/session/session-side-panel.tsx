import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, type JSX, type ValidComponent } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import FileTree from "@/components/file-tree"
import SubagentList from "@/components/subagent-list"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { StickyAddButton } from "@/pages/session/review-tab"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis } from "@/utils/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useComments } from "@/context/comments"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { MOTION_DURATION_NORMAL_TOKEN, getMotionDuration, prefersReducedMotion } from "@/utils/motion"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2/client"

type SessionSidePanelViewModel = {
  messages: () => Message[]
  visibleUserMessages: () => UserMessage[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  info: () => ReturnType<ReturnType<typeof useSync>["session"]["get"]>
}

export function SessionSidePanel(props: {
  desktop: boolean
  open: boolean
  reviewOpen: boolean
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  command: ReturnType<typeof useCommand>
  dialog: ReturnType<typeof useDialog>
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  hasReview: boolean
  reviewCount: number
  childCount: number
  reviewTab: boolean
  sessionID?: string
  onNavigateSession: (sessionID: string) => void
  contextOpen: () => boolean
  openedTabs: () => string[]
  activeTab: () => string
  activeFileTab: () => string | undefined
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  openTab: (value: string) => void
  showAllFiles: () => void
  reviewPanel: () => JSX.Element
  vm: SessionSidePanelViewModel
  handoffFiles: () => Record<string, SelectedLineRange | null> | undefined
  codeComponent: NonNullable<ValidComponent>
  addCommentToContext: (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => void
  activeDraggable: () => string | undefined
  onDragStart: (event: unknown) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent) => void
  fileTreeTab: () => "changes" | "all"
  setFileTreeTabValue: (value: string) => void
  diffsReady: boolean
  diffFiles: string[]
  kinds: Map<string, "add" | "del" | "mix">
  activeDiff?: string
  focusReviewDiff: (path: string) => void
}) {
  const openedTabs = createMemo(() => props.openedTabs())
  const fileTreeOpen = createMemo(() => props.layout.fileTree.opened())
  const [shellPresent, setShellPresent] = createSignal(props.open)
  const [shellVisible, setShellVisible] = createSignal(props.open)
  const [renderReviewOpen, setRenderReviewOpen] = createSignal(props.reviewOpen)
  const [renderFileTreeOpen, setRenderFileTreeOpen] = createSignal(fileTreeOpen())
  const visibleShellWidth = createMemo(() => {
    const reviewWidth = renderReviewOpen() ? props.layout.session.width() : 0
    const fileTreeWidth = renderFileTreeOpen() ? props.layout.fileTree.width() : 0
    return reviewWidth + fileTreeWidth
  })
  const [shellWidth, setShellWidth] = createSignal(visibleShellWidth())
  const reviewContentOpen = createMemo(() => shellVisible() && props.reviewOpen)
  const [panelContentVisible, setPanelContentVisible] = createSignal(reviewContentOpen())
  const [panelContentMounted, setPanelContentMounted] = createSignal(reviewContentOpen())
  const [fileTreeVisible, setFileTreeVisible] = createSignal(fileTreeOpen())
  const [fileTreeMounted, setFileTreeMounted] = createSignal(fileTreeOpen())

  const motionDelay = () => getMotionDuration(MOTION_DURATION_NORMAL_TOKEN, 260)

  createEffect(() => {
    if (!props.open) return

    setShellWidth(visibleShellWidth())
  })

  createEffect(
    on(
      () => props.reviewOpen,
      (isOpen) => {
        if (typeof window === "undefined") {
          setRenderReviewOpen(isOpen)
          return
        }

        if (isOpen) {
          setRenderReviewOpen(true)
          return
        }

        if (!props.open || !renderReviewOpen()) return
        const exitDuration = motionDelay()
        if (prefersReducedMotion() || exitDuration === 0) {
          setRenderReviewOpen(false)
          return
        }

        const timeout = window.setTimeout(() => {
          setRenderReviewOpen(false)
        }, exitDuration)

        return () => window.clearTimeout(timeout)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      fileTreeOpen,
      (isOpen) => {
        if (typeof window === "undefined") {
          setRenderFileTreeOpen(isOpen)
          return
        }

        if (isOpen) {
          setRenderFileTreeOpen(true)
          return
        }

        if (!props.open || !renderFileTreeOpen()) return
        const exitDuration = motionDelay()
        if (prefersReducedMotion() || exitDuration === 0) {
          setRenderFileTreeOpen(false)
          return
        }

        const timeout = window.setTimeout(() => {
          setRenderFileTreeOpen(false)
        }, exitDuration)

        return () => window.clearTimeout(timeout)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => shellVisible() && fileTreeOpen(),
      (isOpen) => {
        if (typeof window === "undefined") {
          setFileTreeVisible(isOpen)
          return
        }

        if (isOpen) {
          if (prefersReducedMotion()) {
            setFileTreeVisible(true)
            return
          }

          setFileTreeVisible(false)
          const frame = window.requestAnimationFrame(() => {
            setFileTreeVisible(true)
          })

          return () => window.cancelAnimationFrame(frame)
        }

        setFileTreeVisible(false)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (typeof window === "undefined") {
          setShellPresent(isOpen)
          setShellVisible(isOpen)
          setRenderReviewOpen(props.reviewOpen)
          setRenderFileTreeOpen(fileTreeOpen())
          setShellWidth(visibleShellWidth())
          return
        }

        if (isOpen) {
          setRenderReviewOpen(props.reviewOpen)
          setRenderFileTreeOpen(fileTreeOpen())
          setShellWidth(visibleShellWidth())
          setShellPresent(true)

          if (prefersReducedMotion()) {
            setShellVisible(true)
            return
          }

          setShellVisible(false)
          const frame = window.requestAnimationFrame(() => {
            setShellVisible(true)
          })

          return () => window.cancelAnimationFrame(frame)
        }

        if (!shellPresent()) return

        const exitDuration = motionDelay()
        if (prefersReducedMotion() || exitDuration === 0) {
          setShellVisible(false)
          setShellPresent(false)
          return
        }

        setShellVisible(false)
        const timeout = window.setTimeout(() => {
          setShellPresent(false)
        }, exitDuration)

        return () => window.clearTimeout(timeout)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      reviewContentOpen,
      (isOpen) => {
        if (typeof window === "undefined") {
          setPanelContentVisible(isOpen)
          setPanelContentMounted(isOpen)
          return
        }

        if (!isOpen) {
          const exitDuration = motionDelay()
          if (prefersReducedMotion() || exitDuration === 0) {
            setPanelContentVisible(false)
            setPanelContentMounted(false)
            return
          }

          setPanelContentVisible(false)
          const timeout = window.setTimeout(() => {
            setPanelContentMounted(false)
          }, exitDuration)
          return () => window.clearTimeout(timeout)
        }

        if (prefersReducedMotion()) {
          setPanelContentVisible(true)
          setPanelContentMounted(true)
          return
        }

        setPanelContentVisible(false)
        setPanelContentMounted(false)
        const enterDelay = motionDelay()
        if (enterDelay === 0) {
          setPanelContentMounted(true)
          setPanelContentVisible(true)
          return
        }

        const timeout = window.setTimeout(() => {
          setPanelContentMounted(true)
          setPanelContentVisible(true)
        }, enterDelay)

        return () => window.clearTimeout(timeout)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => shellVisible() && fileTreeOpen(),
      (isOpen) => {
        if (typeof window === "undefined") {
          setFileTreeMounted(isOpen)
          return
        }

        if (!isOpen) {
          const exitDuration = motionDelay()
          if (prefersReducedMotion() || exitDuration === 0) {
            setFileTreeMounted(false)
            return
          }

          const timeout = window.setTimeout(() => {
            setFileTreeMounted(false)
          }, exitDuration)
          return () => window.clearTimeout(timeout)
        }

        if (prefersReducedMotion()) {
          setFileTreeMounted(true)
          return
        }

        setFileTreeMounted(false)
        const enterDelay = motionDelay()
        if (enterDelay === 0) {
          setFileTreeMounted(true)
          return
        }

        const timeout = window.setTimeout(() => {
          setFileTreeMounted(true)
        }, enterDelay)

        return () => window.clearTimeout(timeout)
      },
      { defer: true },
    ),
  )

  return (
    <Show when={shellPresent() && props.desktop}>
        <aside
          id="review-panel"
          aria-label={props.language.t("session.panel.reviewAndFiles")}
        class="absolute inset-y-0 right-0 z-60 min-w-0 h-full border-l border-border-weak-base flex overflow-hidden bg-background-stronger motion-shell-right"
        classList={{ "motion-shell-right-hidden": !shellVisible() }}
        style={{
          "--motion-shell-x": "20px",
          width: `${shellWidth()}px`,
          "max-width": "100%",
          "pointer-events": shellVisible() ? "auto" : "none",
        }}
      >
        <Show when={renderReviewOpen()}>
          <div class="flex-1 min-w-0 h-full">
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={props.layout.session.width()}
              min={450}
              max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
              onResize={props.layout.session.resize}
            />
            <Show
              when={renderFileTreeOpen() && props.fileTreeTab() === "changes"}
              fallback={
                <DragDropProvider
                  onDragStart={props.onDragStart}
                  onDragEnd={props.onDragEnd}
                  onDragOver={props.onDragOver}
                  collisionDetector={closestCenter}
                >
                  <DragDropSensors />
                  <ConstrainDragYAxis />
                  <Tabs value={props.activeTab()} onChange={props.openTab}>
                    <div class="sticky top-0 shrink-0 flex">
                      <Tabs.List
                        ref={(el: HTMLDivElement) => {
                          const stop = createFileTabListSync({ el, contextOpen: props.contextOpen })
                          onCleanup(stop)
                        }}
                      >
                        <Show when={props.reviewTab}>
                          <Tabs.Trigger value="review" classes={{ button: "!pl-6" }}>
                            <div class="flex items-center gap-1.5">
                              <div>{props.language.t("session.tab.review")}</div>
                              <Show when={props.hasReview}>
                                <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                  {props.reviewCount}
                                </div>
                              </Show>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Show when={props.sessionID}>
                          <Tabs.Trigger value="subagents">
                            <div class="flex items-center gap-1.5">
                              <div>Subagents</div>
                              <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                {props.childCount}
                              </div>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Show when={props.contextOpen()}>
                          <Tabs.Trigger
                            value="context"
                            closeButton={
                              <Tooltip value={props.language.t("common.closeTab")} placement="bottom">
                                <IconButton
                                  icon="close-small"
                                  variant="ghost"
                                  class="h-5 w-5"
                                  onClick={() => props.tabs().close("context")}
                                  aria-label={props.language.t("common.closeTab")}
                                />
                              </Tooltip>
                            }
                            hideCloseButton
                            onMiddleClick={() => props.tabs().close("context")}
                          >
                            <div class="flex items-center gap-2">
                              <SessionContextUsage variant="indicator" />
                              <div>{props.language.t("session.tab.context")}</div>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <SortableProvider ids={openedTabs()}>
                          <For each={openedTabs()}>
                            {(tab) => <SortableTab tab={tab} onTabClose={props.tabs().close} />}
                          </For>
                        </SortableProvider>
                        <StickyAddButton>
                          <TooltipKeybind
                            title={props.language.t("command.file.open")}
                            keybind={props.command.keybind("file.open")}
                            class="flex items-center"
                          >
                            <IconButton
                              icon="plus-small"
                              variant="ghost"
                              iconSize="large"
                              onClick={() =>
                                props.dialog.show(() => (
                                  <DialogSelectFile mode="files" onOpenFile={props.showAllFiles} />
                                ))
                              }
                              aria-label={props.language.t("command.file.open")}
                            />
                          </TooltipKeybind>
                        </StickyAddButton>
                      </Tabs.List>
                    </div>

                    <div
                      class="flex-1 min-h-0 motion-shell-right"
                      classList={{ "motion-shell-right-hidden": !panelContentVisible() }}
                      style={{
                        "--motion-shell-x": "14px",
                        "pointer-events": panelContentVisible() ? "auto" : "none",
                      }}
                    >
                      <Show when={props.reviewTab}>
                        <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={panelContentMounted() && props.activeTab() === "review"}>{props.reviewPanel()}</Show>
                        </Tabs.Content>
                      </Show>

                      <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                        <Show when={props.activeTab() === "empty"}>
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                              <Mark class="w-14 opacity-10" />
                              <div class="text-14-regular text-text-weak max-w-56">
                                {props.language.t("session.files.selectToOpen")}
                              </div>
                            </div>
                          </div>
                        </Show>
                      </Tabs.Content>

                      <Show when={props.sessionID} keyed>
                        {(sessionID) => (
                          <Tabs.Content value="subagents" class="flex flex-col h-full overflow-hidden contain-strict">
                            <Show when={panelContentMounted() && props.activeTab() === "subagents"}>
                              <SubagentList sessionID={sessionID} onNavigateSession={props.onNavigateSession} />
                            </Show>
                          </Tabs.Content>
                        )}
                      </Show>

                      <Show when={props.contextOpen()}>
                        <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                          <Show when={panelContentMounted() && props.activeTab() === "context"}>
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <SessionContextTab
                                messages={props.vm.messages}
                                visibleUserMessages={props.vm.visibleUserMessages}
                                view={props.vm.view}
                                info={props.vm.info}
                              />
                            </div>
                          </Show>
                        </Tabs.Content>
                      </Show>

                      <Show when={props.activeFileTab()} keyed>
                        {(tab) => (
                          <Show when={panelContentMounted()}>
                            <FileTabContent
                              tab={tab}
                              activeTab={props.activeTab}
                              tabs={props.tabs}
                              view={props.vm.view}
                              handoffFiles={props.handoffFiles}
                              file={props.file}
                              comments={props.comments}
                              language={props.language}
                              codeComponent={props.codeComponent}
                              addCommentToContext={props.addCommentToContext}
                            />
                          </Show>
                        )}
                      </Show>
                    </div>
                  </Tabs>
                  <DragOverlay>
                    <Show when={props.activeDraggable()}>
                      {(tab) => {
                        const path = createMemo(() => props.file.pathFromTab(tab()))
                        return (
                          <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                            <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                          </div>
                        )
                      }}
                    </Show>
                  </DragOverlay>
                </DragDropProvider>
              }
            >
              <Show when={panelContentMounted()}>{props.reviewPanel()}</Show>
            </Show>
          </div>
        </Show>

        <Show when={renderFileTreeOpen()}>
          <div
            id="file-tree-panel"
            class="relative shrink-0 h-full motion-shell-right"
            classList={{ "motion-shell-right-hidden": !fileTreeVisible() }}
            style={{
              "--motion-shell-x": "14px",
              width: `${props.layout.fileTree.width()}px`,
              "pointer-events": fileTreeVisible() ? "auto" : "none",
            }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": renderReviewOpen() }}
            >
              <Tabs
                variant="pill"
                value={props.fileTreeTab()}
                onChange={props.setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {props.reviewCount}{" "}
                    {props.language.t(
                      props.reviewCount === 1 ? "session.review.change.one" : "session.review.change.other",
                    )}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {props.language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-base px-3 py-0">
                  <Switch>
                    <Match when={props.hasReview}>
                      <Show
                        when={props.diffsReady}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {props.language.t("common.loading")}
                            {props.language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <Show
                          when={fileTreeMounted()}
                          fallback={
                            <div class="px-2 py-2 text-12-regular text-text-weak">
                              {props.language.t("common.loading")}
                              {props.language.t("common.loading.ellipsis")}
                            </div>
                          }
                        >
                          <FileTree
                            path=""
                            allowed={props.diffFiles}
                            kinds={props.kinds}
                            draggable={false}
                            active={props.activeDiff}
                            onFileClick={(node) => props.focusReviewDiff(node.path)}
                          />
                        </Show>
                      </Show>
                    </Match>
                    <Match when={true}>
                      <div class="mt-8 text-center text-12-regular text-text-weak">
                        {props.language.t("session.review.noChanges")}
                      </div>
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-base px-3 py-0">
                  <Show
                    when={fileTreeMounted()}
                    fallback={
                      <div class="px-2 py-2 text-12-regular text-text-weak">
                        {props.language.t("common.loading")}
                        {props.language.t("common.loading.ellipsis")}
                      </div>
                    }
                  >
                    <FileTree
                      path=""
                      modified={props.diffFiles}
                      kinds={props.kinds}
                      onFileClick={(node) => props.openTab(props.file.tab(node.path))}
                    />
                  </Show>
                </Tabs.Content>
              </Tabs>
            </div>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={props.layout.fileTree.width()}
              min={200}
              max={480}
              collapseThreshold={160}
              onResize={props.layout.fileTree.resize}
              onCollapse={props.layout.fileTree.close}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
