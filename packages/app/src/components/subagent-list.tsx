import { ContextHealth } from "@opencode-ai/ui/context-health"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { type Session } from "@opencode-ai/sdk/v2"
import { type AssistantMessage, type Message } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { isActiveSubagentStatus, selectSubagentsForAutoHydration } from "./subagent-list-helpers"

const INITIAL_VISIBLE_SUBAGENTS = 60
const SUBAGENT_RENDER_BATCH = 40
const SUBAGENT_HYDRATION_BATCH = 12
const SUBAGENT_HYDRATION_DELAY_MS = 80

function sortChildren(list: Session[]) {
  return [...list].sort((a, b) => {
    const aTime = a.time.updated ?? a.time.created ?? 0
    const bTime = b.time.updated ?? b.time.created ?? 0
    return bTime - aTime
  })
}

function upsertChild(list: Session[], next: Session) {
  const filtered = list.filter((item) => item.id !== next.id)
  if (next.time.archived) return sortChildren(filtered)
  return sortChildren([...filtered, next])
}

function removeChild(list: Session[], sessionID: string) {
  return sortChildren(list.filter((item) => item.id !== sessionID))
}

function newerSession(current: Session | undefined, next: Session) {
  if (!current) return next
  const currentTime = current.time.updated ?? current.time.created ?? 0
  const nextTime = next.time.updated ?? next.time.created ?? 0
  return nextTime >= currentTime ? next : current
}

function mergeChildren(current: Session[], fetched: Session[], removed: Map<string, number>) {
  const next = new Map(current.map((session) => [session.id, session]))
  for (const session of fetched) {
    const removedAt = removed.get(session.id)
    const sessionTime = session.time.updated ?? session.time.created ?? 0
    if (removedAt !== undefined && removedAt >= sessionTime) continue
    next.set(session.id, newerSession(next.get(session.id), session))
  }
  return sortChildren(
    Array.from(next.values()).filter((session) => {
      const removedAt = removed.get(session.id)
      const sessionTime = session.time.updated ?? session.time.created ?? 0
      return !session.time.archived && (removedAt === undefined || removedAt < sessionTime)
    }),
  )
}

function lastAssistant(messages: Message[] = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "assistant") return message as AssistantMessage
  }
}

export default function SubagentList(props: { sessionID: string; onNavigateSession: (sessionID: string) => void }) {
  const sdk = useSDK()
  const sync = useSync()
  const [children, setChildren] = createSignal<Session[]>([])
  const [visibleLimit, setVisibleLimit] = createSignal(INITIAL_VISIBLE_SUBAGENTS)
  const [ready, setReady] = createSignal(false)
  const [failedSessions, setFailedSessions] = createSignal<Map<string, number>>(new Map())
  const [removedSessions, setRemovedSessions] = createSignal<Map<string, number>>(new Map())
  const [hydrationRequested, setHydrationRequested] = createSignal<Set<string>>(new Set())
  let hydrationTimer: ReturnType<typeof setTimeout> | undefined

  const hydrateChild = (sessionID: string) => {
    setHydrationRequested((current) => {
      if (current.has(sessionID)) return current
      return new Set(current).add(sessionID)
    })
    void sync.session.sync(sessionID).catch(() => undefined)
  }

  const clearHydrationTimer = () => {
    if (!hydrationTimer) return
    clearTimeout(hydrationTimer)
    hydrationTimer = undefined
  }

  const hydrateChildrenInBatches = (sessionIDs: string[]) => {
    clearHydrationTimer()
    const ids = [...sessionIDs]
    const hydrateBatch = (start: number) => {
      hydrationTimer = undefined
      for (const id of ids.slice(start, start + SUBAGENT_HYDRATION_BATCH)) hydrateChild(id)
      const next = start + SUBAGENT_HYDRATION_BATCH
      if (next < ids.length) hydrationTimer = setTimeout(() => hydrateBatch(next), SUBAGENT_HYDRATION_DELAY_MS)
    }
    hydrateBatch(0)
  }

  const loadedSessionIDs = () => {
    const loaded = new Set(hydrationRequested())
    for (const session of children()) {
      if (sync.data.message[session.id] !== undefined) loaded.add(session.id)
    }
    return loaded
  }

  const hydrateEligibleChildren = () => {
    const ids = selectSubagentsForAutoHydration({
      children: children(),
      statuses: sync.data.session_status,
      hydrated: loadedSessionIDs(),
    })
    if (ids.length === 0) return
    hydrateChildrenInBatches(ids)
  }

  const syncSessions = (sessions: Session[]) => {
    if (sessions.length === 0) return
    sync.set("session", (current) => {
      const next = [...current]
      for (const session of sessions) {
        const index = next.findIndex((item) => item.id === session.id)
        if (index === -1) {
          next.push(session)
          continue
        }
        next[index] = newerSession(next[index], session)
      }
      return next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })
  }

  const refreshChildren = async () => {
    setReady(false)
    try {
      const response = await sdk.client.session.children({ sessionID: props.sessionID })
      const next = sortChildren(
        (response.data ?? []).filter((session): session is Session => !!session && !session.time.archived),
      )
      setChildren((current) => mergeChildren(current, next, removedSessions()))
      syncSessions(next)
      hydrateEligibleChildren()
    } finally {
      setReady(true)
    }
  }

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setChildren([])
        setVisibleLimit(INITIAL_VISIBLE_SUBAGENTS)
        setFailedSessions(new Map())
        setRemovedSessions(new Map())
        setHydrationRequested(new Set<string>())
        clearHydrationTimer()
        void refreshChildren()
      },
      { defer: true },
    ),
  )

  onMount(() => {
    void refreshChildren()

    const created = sdk.event.on("session.created", (event) => {
      const session = event.properties.info
      if (session.parentID !== props.sessionID) return
      const sessionTime = session.time.updated ?? session.time.created ?? 0
      const removedAt = removedSessions().get(session.id)
      if (removedAt !== undefined && removedAt >= sessionTime) return
      setRemovedSessions((current) => {
        if (!current.has(session.id)) return current
        const next = new Map(current)
        next.delete(session.id)
        return next
      })
      setChildren((current) => upsertChild(current, session))
      syncSessions([session])
      hydrateChild(session.id)
    })

    const updated = sdk.event.on("session.updated", (event) => {
      const session = event.properties.info
      const sessionTime = session.time.updated ?? session.time.created ?? 0
      if (session.parentID !== props.sessionID || session.time.archived) {
        setRemovedSessions((removed) => {
          const existing = removed.get(session.id) ?? 0
          if (existing >= sessionTime) return removed
          return new Map(removed).set(session.id, sessionTime)
        })
      }
      setChildren((current) => {
        const tracked = current.some((item) => item.id === session.id)
        if (!tracked && session.parentID !== props.sessionID) return current
        if (session.parentID !== props.sessionID || session.time.archived) {
          return removeChild(current, session.id)
        }
        const removedAt = removedSessions().get(session.id)
        if (removedAt !== undefined && removedAt >= sessionTime) return current
        setRemovedSessions((removed) => {
          if (!removed.has(session.id)) return removed
          const next = new Map(removed)
          next.delete(session.id)
          return next
        })
        return upsertChild(current, session)
      })
      if (session.parentID === props.sessionID && !session.time.archived) {
        syncSessions([session])
        if (isActiveSubagentStatus(sync.data.session_status[session.id])) hydrateChild(session.id)
      }
    })

    const deleted = sdk.event.on("session.deleted", (event) => {
      const session = event.properties.info
      const removedAt = session.time.updated ?? session.time.created ?? Date.now()
      setRemovedSessions((current) => new Map(current).set(session.id, removedAt))
      setChildren((current) => removeChild(current, event.properties.info.id))
      setFailedSessions((current) => {
        if (!current.has(event.properties.info.id)) return current
        const next = new Map(current)
        next.delete(event.properties.info.id)
        return next
      })
    })

    const errored = sdk.event.on("session.error", (event) => {
      const sessionID = event.properties.sessionID
      if (!sessionID) return
      setFailedSessions((current) => {
        const next = new Map(current)
        next.set(sessionID, Date.now())
        return next
      })
    })

    const idled = sdk.event.on("session.idle", (event) => {
      const sessionID = event.properties.sessionID
      if (!children().some((item) => item.id === sessionID)) return
      hydrateChild(sessionID)
    })

    const status = sdk.event.on("session.status", (event) => {
      const sessionID = event.properties.sessionID
      if (!sessionID) return
      if (!children().some((item) => item.id === sessionID)) return
      if (!isActiveSubagentStatus(event.properties.status)) return
      hydrateChild(sessionID)
    })

    onCleanup(() => {
      clearHydrationTimer()
      created()
      updated()
      deleted()
      errored()
      idled()
      status()
    })
  })

  createEffect(
    on(
      () => [children().map((session) => session.id).join("\n"), Object.keys(sync.data.session_status).join("\n")],
      () => hydrateEligibleChildren(),
      { defer: true },
    ),
  )

  const visibleChildren = createMemo(() => children().slice(0, visibleLimit()))
  const hasMore = createMemo(() => visibleLimit() < children().length)
  const showMore = () => setVisibleLimit((limit) => Math.min(children().length, limit + SUBAGENT_RENDER_BATCH))
  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 360) return
    if (hasMore()) showMore()
  }

  const items = createMemo(() =>
    visibleChildren().map((session) => {
      const messages = sync.data.message[session.id] ?? []
      const latest = messages.at(-1)
      const context = getSessionContextMetrics(messages, sync.data.provider?.all ?? []).context
      const syncStatus = sync.data.session_status[session.id]?.type
      const active = syncStatus === "busy" || syncStatus === "retry"
      const loaded = sync.data.message[session.id] !== undefined
      const loading = sync.session.history.loading(session.id)
      const latestCompleted = latest && "completed" in latest.time ? latest.time.completed : undefined
      const latestTime = latestCompleted ?? latest?.time.created ?? 0
      const failedAt = failedSessions().get(session.id) ?? 0
      const failed =
        (latest?.role === "assistant" && !!latest.error) ||
        (failedAt > 0 && sync.data.message[session.id] === undefined) ||
        failedAt > latestTime
      const running = syncStatus === "busy" || syncStatus === "retry"
      const completed = latest?.role === "assistant" && !latest.error && (!!latest.finish || !!latestCompleted)
      const inProgress =
        sync.data.message[session.id] === undefined || latest?.role !== "assistant" || (!failed && !completed)
      const status: "running" | "completed" | "failed" | "unloaded" = !loaded && !active && !failed
        ? "unloaded"
        : failed
        ? "failed"
        : completed
          ? "completed"
          : running || inProgress
            ? "running"
            : "running"
      return {
        session,
        status,
        context,
        active,
        loaded,
        loading,
        agentID: (session as Session & { agentID?: string }).agentID,
        isAsync: (session as Session & { async?: boolean }).async === true,
      }
    }),
  )

  const statusIcon = (status: "running" | "completed" | "failed" | "unloaded") => {
    if (status === "running") {
      return <Spinner class="size-3.5 text-icon-info-base" />
    }
    if (status === "failed") {
      return <Icon name="close-small" size="small" class="text-icon-critical-base" />
    }
    if (status === "unloaded") {
      return <Icon name="status" size="small" class="text-icon-weak" />
    }
    return <Icon name="check-small" size="small" class="text-icon-success-base" />
  }

  const statusLabel = (status: "running" | "completed" | "failed" | "unloaded", isAsync: boolean) => {
    const base = status === "running" ? "Running" : status === "failed" ? "Failed" : status === "unloaded" ? "Context not loaded" : "Completed"
    if (status === "unloaded") return base
    return isAsync ? `Async ${base.toLowerCase()}` : base
  }

  return (
    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden bg-background-stronger">
      <Show when={ready()} fallback={<div class="px-6 py-4 text-12-regular text-text-weak">Loading subagents...</div>}>
        <Show
          when={items().length > 0}
          fallback={
            <div class="h-full px-6 pb-16 flex flex-col items-center justify-center text-center gap-3">
              <div class="text-14-medium text-text-strong">No subagents yet</div>
              <div class="max-w-56 text-12-regular text-text-weak">
                Direct child sessions will appear here as they spawn.
              </div>
            </div>
          }
        >
          <div class="h-full overflow-y-auto px-3 pb-4" onScroll={handleScroll}>
            <div class="flex flex-col gap-2">
              <For each={items()}>
                {(item) => (
                  <div
                    role="button"
                    tabIndex={0}
                    class="w-full cursor-pointer rounded-lg border border-border-weak-base bg-background-base px-3 py-3 text-left transition-colors hover:bg-background-stronger focus-visible:outline focus-visible:outline-1 focus-visible:outline-border-strong"
                    onClick={() => props.onNavigateSession(item.session.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      props.onNavigateSession(item.session.id)
                    }}
                  >
                    <div class="flex items-start gap-3">
                      <div class="mt-0.5 shrink-0">{statusIcon(item.status)}</div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 min-w-0">
                          <div class="truncate text-13-medium text-text-strong">
                            {item.session.title || item.session.id}
                          </div>
                          <Show when={item.agentID}>
                            <div class="shrink-0 rounded-full bg-surface-base px-2 py-0.5 text-11-medium text-text-dimmer capitalize">
                              {item.agentID}
                            </div>
                          </Show>
                          <Show when={item.isAsync}>
                            <div class="shrink-0 rounded-full border border-border-weak-base bg-background-stronger px-2 py-0.5 text-11-medium uppercase tracking-[0.08em] text-text-dimmer">
                              Async
                            </div>
                          </Show>
                        </div>
                        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-11-regular text-text-weak">
                          <span>{statusLabel(item.status, item.isAsync)}</span>
                          <Show when={!item.loaded && item.loading}>
                            <span>Loading context...</span>
                          </Show>
                          <Show when={!item.loaded && !item.loading && !item.active}>
                            <button
                              type="button"
                              class="rounded-full border border-border-weak-base px-2 py-0.5 text-11-medium text-text-weak transition-colors hover:border-border-strong hover:text-text-strong"
                              onKeyDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                hydrateChild(item.session.id)
                              }}
                            >
                              Click to load context
                            </button>
                          </Show>
                        </div>
                      </div>
                      <div class="shrink-0 flex items-center gap-2 text-icon-weak">
                        <Show when={item.loaded}>
                          <ContextHealth
                            current={item.context?.total}
                            limit={item.context?.limit}
                            usage={item.context?.usage}
                            class="hidden sm:inline-flex"
                          />
                        </Show>
                        <Icon name="chevron-right" size="small" />
                      </div>
                    </div>
                  </div>
                )}
              </For>
              <Show when={hasMore()}>
                <button
                  type="button"
                  class="w-full rounded-lg border border-border-weak-base bg-background-base px-3 py-2 text-12-medium text-text-weak transition-colors hover:bg-background-stronger"
                  onClick={showMore}
                >
                  Show {Math.min(SUBAGENT_RENDER_BATCH, children().length - visibleLimit())} more subagents
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}
