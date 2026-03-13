import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/util/binary"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type PermissionGroup = {
  sessionID: string
  title: string
  path: string
  items: PermissionRequest[]
}

export function PermissionOverlay(props: { dir: string; directory: string }) {
  const navigate = useNavigate()
  const language = useLanguage()
  const permission = usePermission()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const child = createMemo(() => globalSync.child(props.directory))
  const [open, setOpen] = createSignal(false)
  const inflight = new Set<string>()

  const pendingPermissions = createMemo(() =>
    Object.values(child()[0].permission)
      .flat()
      .filter((item): item is PermissionRequest => !!item?.id),
  )

  const pendingCount = createMemo(() => pendingPermissions().length)

  const sessionInfo = (sessionID: string) => child()[0].session.find((session) => session.id === sessionID)

  const loadSession = async (sessionID: string) => {
    if (!sessionID || inflight.has(sessionID)) return
    const current = Binary.search(child()[0].session, sessionID, (session) => session.id)
    if (current.found) return

    inflight.add(sessionID)
    await globalSDK.client.session
      .get({ sessionID, directory: props.directory })
      .then((result) => {
        const session = result.data
        if (!session) return
        child()[1](
          "session",
          produce((draft) => {
            const match = Binary.search(draft, session.id, (item) => item.id)
            if (match.found) {
              draft[match.index] = session
              return
            }
            draft.splice(match.index, 0, session)
            draft.sort((a, b) => cmp(a.id, b.id))
          }),
        )
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(sessionID))
  }

  createEffect(() => {
    const ids = [...new Set(pendingPermissions().map((item) => item.sessionID))]
    void (async () => {
      for (const sessionID of ids) {
        await loadSession(sessionID)
        let parentID = sessionInfo(sessionID)?.parentID
        const visited = new Set<string>()
        while (parentID && !visited.has(parentID)) {
          visited.add(parentID)
          await loadSession(parentID)
          parentID = sessionInfo(parentID)?.parentID
        }
      }
    })()
  })

  createEffect(() => {
    if (open() && pendingCount() === 0) setOpen(false)
  })

  const sessionPath = (sessionID: string) => {
    const path: string[] = []
    const visited = new Set<string>()
    let currentID: string | undefined = sessionID

    while (currentID && !visited.has(currentID)) {
      visited.add(currentID)
      const session = sessionInfo(currentID)
      if (!session) break
      path.unshift(session.title || session.id)
      currentID = session.parentID
    }

    return path.join(" / ")
  }

  const grouped = createMemo<PermissionGroup[]>(() => {
    const map = new Map<string, PermissionGroup>()
    for (const item of pendingPermissions()) {
      const existing = map.get(item.sessionID)
      if (existing) {
        existing.items.push(item)
        continue
      }

      const session = sessionInfo(item.sessionID)
      map.set(item.sessionID, {
        sessionID: item.sessionID,
        title: session?.title || item.sessionID,
        path: sessionPath(item.sessionID),
        items: [item],
      })
    }

    return [...map.values()].sort((a, b) => cmp(a.title, b.title))
  })

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    permission.respond({ ...input, directory: props.directory })
  }

  return (
    <>
      <Show when={pendingCount() > 0}>
        <button
          type="button"
          class="fixed top-11 right-3 z-[85] flex items-center gap-2 rounded-full border border-border-base bg-background-base px-3 py-1.5 shadow-sm transition-colors hover:bg-background-stronger"
          onClick={() => setOpen(true)}
          aria-label={language.t("notification.permission.title")}
        >
          <Icon name="checklist" size="small" />
          <span class="text-12-medium text-text-strong">{pendingCount()}</span>
        </button>
      </Show>

      <Show when={open()}>
        <div class="fixed inset-0 z-[95]">
          <button
            type="button"
            class="absolute inset-0 bg-background-overlay/50"
            onClick={() => setOpen(false)}
            aria-label={language.t("common.dismiss")}
          />
          <div class="absolute top-8 right-0 bottom-0 w-full max-w-md border-l border-border-base bg-background-base shadow-2xl">
            <div class="flex items-center justify-between gap-3 border-b border-border-base px-4 py-3">
              <div class="min-w-0">
                <div class="text-14-medium text-text-strong">{language.t("notification.permission.title")}</div>
                <div class="text-12-regular text-text-weak">{pendingCount()}</div>
              </div>
              <Button variant="ghost" size="small" onClick={() => setOpen(false)}>
                {language.t("common.close")}
              </Button>
            </div>

            <div class="h-full overflow-y-auto px-4 py-4 pb-12">
              <div class="flex flex-col gap-4">
                <For each={grouped()}>
                  {(group) => (
                    <section class="rounded-xl border border-border-base bg-background-stronger p-3">
                      <button
                        type="button"
                        class="mb-3 flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => {
                          navigate(`/${props.dir}/session/${group.sessionID}`)
                          setOpen(false)
                        }}
                      >
                        <div class="min-w-0">
                          <div class="truncate text-13-medium text-text-strong">{group.title}</div>
                          <div class="truncate text-11-regular text-text-weak">{group.path || group.sessionID}</div>
                        </div>
                        <Icon name="chevron-right" size="small" class="shrink-0 text-icon-weak" />
                      </button>

                      <div class="flex flex-col gap-3">
                        <For each={group.items}>
                          {(item) => (
                            <div class="rounded-lg border border-border-base bg-background-base p-3">
                              <div class="text-12-medium text-text-strong">{item.permission}</div>
                              <div class="mt-1 flex flex-col gap-1">
                                <For each={item.patterns.slice(0, 3)}>
                                  {(pattern) => <code class="text-11-regular text-text-weak break-all">{pattern}</code>}
                                </For>
                              </div>
                              <div class="mt-3 flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="small"
                                  onClick={() => respond({ sessionID: item.sessionID, permissionID: item.id, response: "reject" })}
                                >
                                  {language.t("ui.permission.deny")}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="small"
                                  onClick={() => respond({ sessionID: item.sessionID, permissionID: item.id, response: "always" })}
                                >
                                  {language.t("ui.permission.allowAlways")}
                                </Button>
                                <Button
                                  variant="primary"
                                  size="small"
                                  onClick={() => respond({ sessionID: item.sessionID, permissionID: item.id, response: "once" })}
                                >
                                  {language.t("ui.permission.allowOnce")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
