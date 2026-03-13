import { For, createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Transition } from "solid-transition-group"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { ContextHealth } from "@opencode-ai/ui/context-health"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionBreadcrumb } from "@/pages/session/session-breadcrumb"
import { MOTION_DURATION_SLOW_TOKEN, getMotionDuration } from "@/utils/motion"

type BreadcrumbItem = { id: string; title: string; current?: number; limit?: number; usage?: number | null }
type ContextHealthState = { current: number; limit?: number; usage: number | null }
export type SessionNavigationDirection = "deeper" | "shallower" | "lateral"
type TimelineSnapshot = {
  sessionID: string
  showHeader: boolean
  centered: boolean
  title?: string
  parentID?: string
  breadcrumbs: BreadcrumbItem[]
  currentContextHealth?: ContextHealthState
  turnStart: number
  historyMore: boolean
  historyLoading: boolean
  renderedUserMessages: UserMessage[]
  lastUserMessageID?: string
  expanded: Record<string, boolean>
  scrollTop: number
}

const SESSION_EXIT_DURATION_TOKEN = MOTION_DURATION_SLOW_TOKEN
const SESSION_ENTER_DURATION_TOKEN = MOTION_DURATION_SLOW_TOKEN

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function TimelineSnapshotLayer(props: {
  snapshot: TimelineSnapshot
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  anchor: (id: string) => string
  exiting: boolean
  direction: SessionNavigationDirection
}) {
  const motionRestClass = () => (props.direction === "lateral" ? "motion-crossfade" : "motion-session-rest")
  const motionExitClass = () => {
    if (props.direction === "deeper") return "motion-session-exit-deeper"
    if (props.direction === "shallower") return "motion-session-exit-shallower"
    return "motion-crossfade-out"
  }

  return (
    <div
      class={`absolute inset-0 z-10 pointer-events-none ${motionRestClass()}`}
      classList={{
        [motionExitClass()]: props.exiting,
      }}
    >
      <div
        ref={(el) => {
          el.scrollTop = props.snapshot.scrollTop
        }}
        class="relative min-w-0 w-full h-full overflow-y-auto session-scroller"
        style={{ "--session-title-height": props.snapshot.showHeader ? "40px" : "0px" }}
      >
        <Show when={props.snapshot.showHeader}>
          <div
            classList={{
              "sticky top-0 z-30 bg-background-stronger": true,
              "w-full": true,
              "px-4 md:px-6": true,
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.snapshot.centered,
            }}
          >
            <div class="min-h-10 w-full flex items-center justify-between gap-3 py-2.5">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <Show when={props.snapshot.parentID}>
                  <IconButton tabIndex={-1} icon="arrow-left" variant="ghost" aria-label={props.t("common.goBack")} />
                </Show>
                <div class="min-w-0 flex-1">
                  <SessionBreadcrumb items={props.snapshot.breadcrumbs} onNavigate={() => undefined} />
                  <Show when={props.snapshot.title}>
                    <h1 class="text-16-medium text-text-strong truncate min-w-0">{props.snapshot.title}</h1>
                  </Show>
                </div>
              </div>
              <Show when={props.snapshot.currentContextHealth}>
                {(health) => (
                  <ContextHealth
                    current={health().current}
                    limit={health().limit}
                    usage={health().usage}
                    class="mr-2 hidden md:inline-flex"
                  />
                )}
              </Show>
            </div>
          </div>
        </Show>

        <div
          role="log"
          class="flex flex-col gap-12 items-start justify-start pb-[calc(var(--prompt-height,6rem)+56px)] sm:pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
          classList={{
            "w-full": true,
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.snapshot.centered,
            "mt-0.5": props.snapshot.centered,
            "mt-0": !props.snapshot.centered,
          }}
        >
          <Show when={props.snapshot.turnStart > 0}>
            <div class="w-full flex justify-center">
              <Button variant="ghost" size="large" class="text-12-medium opacity-50" disabled>
                {props.t("session.messages.renderEarlier")}
              </Button>
            </div>
          </Show>
          <Show when={props.snapshot.historyMore}>
            <div class="w-full flex justify-center">
              <Button variant="ghost" size="large" class="text-12-medium opacity-50" disabled>
                {props.snapshot.historyLoading
                  ? props.t("session.messages.loadingEarlier")
                  : props.t("session.messages.loadEarlier")}
              </Button>
            </div>
          </Show>
          <For each={props.snapshot.renderedUserMessages}>
            {(message) => (
              <div
                id={props.anchor(message.id)}
                data-message-id={message.id}
                classList={{
                  "min-w-0 w-full max-w-full": true,
                  "md:max-w-200 2xl:max-w-[1000px]": props.snapshot.centered,
                }}
              >
                <SessionTurn
                  sessionID={props.snapshot.sessionID}
                  messageID={message.id}
                  lastUserMessageID={props.snapshot.lastUserMessageID}
                  stepsExpanded={props.snapshot.expanded[message.id] ?? true}
                  onStepsExpandedToggle={() => undefined}
                  classes={{
                    root: "min-w-0 w-full relative",
                    content: "flex flex-col justify-between !overflow-visible",
                    container: "w-full px-4 md:px-6",
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  scroll: { overflow: boolean; bottom: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  isDesktop: boolean
  onScrollSpyScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  showHeader: boolean
  centered: boolean
  title?: string
  parentID?: string
  breadcrumbs: { id: string; title: string; current?: number; limit?: number; usage?: number | null }[]
  currentContextHealth?: { current: number; limit?: number; usage: number | null }
  openTitleEditor: () => void
  closeTitleEditor: () => void
  saveTitleEditor: () => void | Promise<void>
  titleRef: (el: HTMLInputElement) => void
  titleState: {
    draft: string
    editing: boolean
    saving: boolean
    menuOpen: boolean
    pendingRename: boolean
  }
  onTitleDraft: (value: string) => void
  onTitleMenuOpen: (open: boolean) => void
  onTitlePendingRename: (value: boolean) => void
  onNavigateParent: () => void
  onNavigateSession: (sessionID: string) => void
  sessionID: string
  onArchiveSession: (sessionID: string) => void
  onDeleteSession: (sessionID: string) => void
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  setContentRef: (el: HTMLDivElement) => void
  turnStart: number
  onRenderEarlier: () => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  anchor: (id: string) => string
  onRegisterMessage: (el: HTMLDivElement, id: string) => void
  onUnregisterMessage: (id: string) => void
  onFirstTurnMount?: () => void
  lastUserMessageID?: string
  expanded: Record<string, boolean>
  onToggleExpanded: (id: string) => void
  navigationDirection: SessionNavigationDirection
}) {
  let touchGesture: number | undefined
  let timelineScroller: HTMLDivElement | undefined
  let crossfadeTimeout: ReturnType<typeof setTimeout> | undefined
  let enterTimeout: ReturnType<typeof setTimeout> | undefined
  let crossfadeFrame: number | undefined
  const [entering, setEntering] = createSignal(false)
  const [leaving, setLeaving] = createSignal<TimelineSnapshot>()
  const [leavingTransitioning, setLeavingTransitioning] = createSignal(false)

  const clearCrossfade = () => {
    if (crossfadeTimeout !== undefined) {
      clearTimeout(crossfadeTimeout)
      crossfadeTimeout = undefined
    }
    if (enterTimeout !== undefined) {
      clearTimeout(enterTimeout)
      enterTimeout = undefined
    }
    if (crossfadeFrame !== undefined) {
      cancelAnimationFrame(crossfadeFrame)
      crossfadeFrame = undefined
    }
  }

  const snapshot = () => ({
    sessionID: props.sessionID,
    showHeader: props.showHeader,
    centered: props.centered,
    title: props.title,
    parentID: props.parentID,
    breadcrumbs: props.breadcrumbs.map((item) => ({ ...item })),
    currentContextHealth: props.currentContextHealth ? { ...props.currentContextHealth } : undefined,
    turnStart: props.turnStart,
    historyMore: props.historyMore,
    historyLoading: props.historyLoading,
    renderedUserMessages: [...props.renderedUserMessages],
    lastUserMessageID: props.lastUserMessageID,
    expanded: { ...props.expanded },
    scrollTop: timelineScroller?.scrollTop ?? 0,
  })

  createEffect(
    on(
      snapshot,
      (current, previous) => {
        if (!previous || current.sessionID === previous.sessionID) return

        clearCrossfade()
        const exitDuration = getMotionDuration(SESSION_EXIT_DURATION_TOKEN, 380)
        const enterDuration = getMotionDuration(SESSION_ENTER_DURATION_TOKEN, 380)
        const previousFrame = { ...previous, scrollTop: timelineScroller?.scrollTop ?? previous.scrollTop }

        if (exitDuration === 0 && enterDuration === 0) {
          setLeaving(undefined)
          setLeavingTransitioning(false)
          setEntering(false)
          return
        }

        setLeaving(previousFrame)
        setLeavingTransitioning(false)
        setEntering(true)

        crossfadeFrame = requestAnimationFrame(() => {
          setLeavingTransitioning(true)
          crossfadeFrame = undefined
        })

        enterTimeout = setTimeout(() => {
          setEntering(false)
          enterTimeout = undefined
        }, enterDuration)

        crossfadeTimeout = setTimeout(() => {
          setLeaving(undefined)
          setLeavingTransitioning(false)
          crossfadeTimeout = undefined
        }, Math.max(exitDuration, enterDuration))
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    clearCrossfade()
    setLeaving(undefined)
  })

  const setTimelineScrollRef = (el: HTMLDivElement | undefined) => {
    timelineScroller = el
    props.setScrollRef(el)
  }

  const liveMotionRestClass = () =>
    props.navigationDirection === "lateral" ? "motion-crossfade" : "motion-session-rest"
  const liveMotionEnterClass = () => {
    if (props.navigationDirection === "deeper") return "motion-session-enter-deeper"
    if (props.navigationDirection === "shallower") return "motion-session-enter-shallower"
    return "motion-crossfade-out"
  }

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <Show when={leaving()}>
          {(previous) => (
            <TimelineSnapshotLayer
              snapshot={previous()}
              t={props.t}
              anchor={props.anchor}
              exiting={leavingTransitioning()}
              direction={props.navigationDirection}
            />
          )}
        </Show>
        <div
          class={`relative w-full h-full min-w-0 ${liveMotionRestClass()}`}
          classList={{
            [liveMotionEnterClass()]: entering(),
          }}
        >
          <div class="absolute inset-x-0 bottom-[calc(var(--prompt-height,6rem)+32px)] sm:bottom-[calc(var(--prompt-height,8rem)+32px)] z-[60] flex justify-center pointer-events-none">
            <Transition name="motion-scroll-btn">
              <Show when={props.scroll.overflow && !props.scroll.bottom}>
                <button
                  class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
                  onClick={props.onResumeScroll}
                >
                  <Icon name="arrow-down-to-line" />
                </button>
              </Show>
            </Transition>
          </div>
          <div
            ref={setTimelineScrollRef}
            onWheel={(e) => {
              const root = e.currentTarget
              const delta = normalizeWheelDelta({
                deltaY: e.deltaY,
                deltaMode: e.deltaMode,
                rootHeight: root.clientHeight,
              })
              if (!delta) return
              markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
            }}
            onTouchStart={(e) => {
              touchGesture = e.touches[0]?.clientY
            }}
            onTouchMove={(e) => {
              const next = e.touches[0]?.clientY
              const prev = touchGesture
              touchGesture = next
              if (next === undefined || prev === undefined) return

              const delta = prev - next
              if (!delta) return

              const root = e.currentTarget
              markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
            }}
            onTouchEnd={() => {
              touchGesture = undefined
            }}
            onTouchCancel={() => {
              touchGesture = undefined
            }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return
              props.onMarkScrollGesture(e.currentTarget)
            }}
            onScroll={(e) => {
              props.onScheduleScrollState(e.currentTarget)
              if (!props.hasScrollGesture()) return
              props.onAutoScrollHandleScroll()
              props.onMarkScrollGesture(e.currentTarget)
              if (props.isDesktop) props.onScrollSpyScroll()
            }}
            onClick={props.onAutoScrollInteraction}
            class="relative min-w-0 w-full h-full overflow-y-auto session-scroller"
            style={{ "--session-title-height": props.showHeader ? "40px" : "0px" }}
          >
            <Show when={props.showHeader}>
              <div
                classList={{
                  "sticky top-0 z-30 bg-background-stronger": true,
                  "w-full": true,
                  "px-4 md:px-6": true,
                  "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
                }}
              >
                <div class="min-h-10 w-full flex items-center justify-between gap-3 py-2.5">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <Show when={props.parentID}>
                      <IconButton
                        tabIndex={-1}
                        icon="arrow-left"
                        variant="ghost"
                        onClick={props.onNavigateParent}
                        aria-label={props.t("common.goBack")}
                      />
                    </Show>
                    <div class="min-w-0 flex-1">
                      <SessionBreadcrumb items={props.breadcrumbs} onNavigate={props.onNavigateSession} />
                      <Show when={props.title || props.titleState.editing}>
                        <Show when={!props.titleState.editing}>
                          <h1 class="text-16-medium text-text-strong truncate min-w-0" onDblClick={props.openTitleEditor}>
                            {props.title}
                          </h1>
                        </Show>
                        <Show when={props.titleState.editing}>
                          <InlineInput
                            ref={props.titleRef}
                            value={props.titleState.draft}
                            disabled={props.titleState.saving}
                            class="text-16-medium text-text-strong grow-1 min-w-0"
                          onInput={(event) => props.onTitleDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === "Enter") {
                              event.preventDefault()
                              void props.saveTitleEditor()
                              return
                            }
                            if (event.key === "Escape") {
                              event.preventDefault()
                              props.closeTitleEditor()
                            }
                          }}
                          onBlur={props.closeTitleEditor}
                        />
                      </Show>
                    </Show>
                  </div>
                </div>
                <Show when={props.sessionID}>
                  {(id) => (
                    <div class="shrink-0 flex items-center">
                      <Show when={props.currentContextHealth}>
                        {(health) => (
                          <ContextHealth
                            current={health().current}
                            limit={health().limit}
                            usage={health().usage}
                            class="mr-2 hidden md:inline-flex"
                          />
                        )}
                      </Show>
                      <DropdownMenu open={props.titleState.menuOpen} onOpenChange={props.onTitleMenuOpen}>
                        <Tooltip value={props.t("common.moreOptions")} placement="top">
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="dot-grid"
                            variant="ghost"
                            class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                            aria-label={props.t("common.moreOptions")}
                          />
                        </Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            onCloseAutoFocus={(event) => {
                              if (!props.titleState.pendingRename) return
                              event.preventDefault()
                              props.onTitlePendingRename(false)
                              props.openTitleEditor()
                            }}
                          >
                            <DropdownMenu.Item
                              onSelect={() => {
                                props.onTitlePendingRename(true)
                                props.onTitleMenuOpen(false)
                              }}
                            >
                              <DropdownMenu.ItemLabel>{props.t("common.rename")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={() => props.onArchiveSession(id())}>
                              <DropdownMenu.ItemLabel>{props.t("common.archive")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item onSelect={() => props.onDeleteSession(id())}>
                              <DropdownMenu.ItemLabel>{props.t("common.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          </Show>

          <div
            ref={props.setContentRef}
            role="log"
            class="flex flex-col gap-12 items-start justify-start pb-[calc(var(--prompt-height,6rem)+56px)] sm:pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
            classList={{
              "w-full": true,
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
              "mt-0.5": props.centered,
              "mt-0": !props.centered,
            }}
          >
            <Show when={props.turnStart > 0}>
              <div class="w-full flex justify-center">
                <Button variant="ghost" size="large" class="text-12-medium opacity-50" onClick={props.onRenderEarlier}>
                  {props.t("session.messages.renderEarlier")}
                </Button>
              </div>
            </Show>
            <Show when={props.historyMore}>
              <div class="w-full flex justify-center">
                <Button
                  variant="ghost"
                  size="large"
                  class="text-12-medium opacity-50"
                  disabled={props.historyLoading}
                  onClick={props.onLoadEarlier}
                >
                  {props.historyLoading
                    ? props.t("session.messages.loadingEarlier")
                    : props.t("session.messages.loadEarlier")}
                </Button>
              </div>
            </Show>
            <For each={props.renderedUserMessages}>
              {(message) => {
                if (import.meta.env.DEV && props.onFirstTurnMount) {
                  onMount(() => props.onFirstTurnMount?.())
                }

                return (
                  <div
                    id={props.anchor(message.id)}
                    data-message-id={message.id}
                    ref={(el) => {
                      props.onRegisterMessage(el, message.id)
                      onCleanup(() => props.onUnregisterMessage(message.id))
                    }}
                    classList={{
                      "min-w-0 w-full max-w-full": true,
                      "md:max-w-200 2xl:max-w-[1000px]": props.centered,
                    }}
                  >
                    <SessionTurn
                      sessionID={props.sessionID}
                      messageID={message.id}
                      lastUserMessageID={props.lastUserMessageID}
                      stepsExpanded={props.expanded[message.id] ?? true}
                      onStepsExpandedToggle={() => props.onToggleExpanded(message.id)}
                      classes={{
                        root: "min-w-0 w-full relative",
                        content: "flex flex-col justify-between !overflow-visible",
                        container: "w-full px-4 md:px-6",
                      }}
                    />
                  </div>
                )
              }}
            </For>
          </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
