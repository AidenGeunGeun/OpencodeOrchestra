import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { retry } from "@opencode-ai/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { perfDuration, perfLog, perfMeasure } from "@/utils/perf"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  connectErrorTitle: string
  connectErrorDescription: string
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
}) {
  const start = performance.now()
  const health = await input.globalSDK.global
    .health()
    .then((x) => x.data)
    .catch(() => undefined)
  if (!health?.healthy) {
    showToast({
      variant: "error",
      title: input.connectErrorTitle,
      description: input.connectErrorDescription,
    })
    input.setGlobalStore("ready", true)
    perfLog("global.bootstrap", { durationMs: perfDuration(start), healthy: false })
    return
  }

  const request = <T>(name: string, fn: () => Promise<T>) => perfMeasure(`global.bootstrap.request.${name}`, fn)

  // OCO: `path` is the only task the router truly blocks on (it drives the
  // resolved working directory). Resolve it first, mark ready, then let the
  // other four fetches finish in the background. Consumers react when each
  // slice lands (their default values — `[]`, `{}` — already render harmless
  // skeletons in the meantime).
  const pathTask = request("path", () =>
    retry(() =>
      input.globalSDK.path.get().then((x) => {
        input.setGlobalStore("path", reconcile(x.data!))
      }),
    ),
  )

  const backgroundTasks = [
    request("config", () =>
      retry(() =>
        input.globalSDK.config.get().then((x) => {
          input.setGlobalStore("config", reconcile(x.data!))
        }),
      ),
    ),
    request("project.list", () =>
      retry(() =>
        input.globalSDK.project.list().then((x) => {
          const projects = (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
          // setGlobalStore for "project" routes through setProjects, which now
          // applies a keyed reconcile internally.
          input.setGlobalStore("project", projects)
        }),
      ),
    ),
    request("provider.list", () =>
      retry(() =>
        input.globalSDK.provider.list().then((x) => {
          // OCO: split per-field so the `all` array gets keyed reconcile (Provider has `id`).
          // A keyless reconcile on `all` would treat any server-side reorder as a churn event
          // for every consumer doing `provider.all.find(...)`.
          const norm = normalizeProviderList(x.data!)
          batch(() => {
            input.setGlobalStore("provider", "all", reconcile(norm.all, { key: "id" }))
            input.setGlobalStore("provider", "connected", reconcile(norm.connected))
            input.setGlobalStore("provider", "default", reconcile(norm.default))
          })
        }),
      ),
    ),
    request("provider.auth", () =>
      retry(() =>
        input.globalSDK.provider.auth().then((x) => {
          input.setGlobalStore("provider_auth", reconcile(x.data ?? {}))
        }),
      ),
    ),
  ]

  // Wait for path; flip ready as soon as it lands so the shell can paint.
  let pathError: unknown
  try {
    await pathTask
  } catch (error) {
    pathError = error
  }
  input.setGlobalStore("ready", true)

  // Keep the existing error-toast contract: if any task fails, surface the
  // first error and a "+N more" count once *all* finish. This runs after the
  // shell is already interactive.
  const backgroundResults = await Promise.allSettled(backgroundTasks)
  const errors: unknown[] = []
  if (pathError !== undefined) errors.push(pathError)
  for (const r of backgroundResults) if (r.status === "rejected") errors.push(r.reason)
  if (errors.length) {
    const message = formatServerError(errors[0], input.translate)
    const more = errors.length > 1 ? input.formatMoreCount(errors.length - 1) : ""
    showToast({
      variant: "error",
      title: input.requestFailedTitle,
      description: message + more,
    })
  }
  perfLog("global.bootstrap", {
    durationMs: perfDuration(start),
    healthy: true,
    requests: 1 + backgroundTasks.length,
    errors: errors.length,
  })
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  const start = performance.now()
  const warm = input.store.status === "complete"
  perfLog("directory.bootstrap.start", { directory: input.directory, warm })
  if (input.store.status !== "complete") input.setStore("status", "loading")

  const request = <T>(phase: string, name: string, fn: () => Promise<T>) =>
    perfMeasure(`directory.bootstrap.${phase}.${name}`, fn, { directory: input.directory })

  const blockingRequests = {
    project: () =>
      request("blocking", "project.current", () =>
        input.sdk.project.current().then((x) => input.setStore("project", x.data!.id)),
      ),
    provider: () =>
      request("blocking", "provider.list", () =>
        input.sdk.provider.list().then((x) => {
          // OCO: per-field reconcile so .all gets keyed identity preservation; see
          // global bootstrapGlobal for the same pattern.
          const norm = normalizeProviderList(x.data!)
          batch(() => {
            input.setStore("provider", "all", reconcile(norm.all, { key: "id" }))
            input.setStore("provider", "connected", reconcile(norm.connected))
            input.setStore("provider", "default", reconcile(norm.default))
          })
        }),
      ),
    agent: () =>
      request("blocking", "app.agents", () =>
        // OCO: Agent has a stable `name`; keyed reconcile preserves identity across re-fetches.
        input.sdk.app.agents().then((x) => input.setStore("agent", reconcile(x.data ?? [], { key: "name" }))),
      ),
    config: () =>
      request("blocking", "config", () =>
        input.sdk.config.get().then((x) => input.setStore("config", reconcile(x.data!))),
      ),
  }

  try {
    await Promise.all(Object.values(blockingRequests).map((p) => retry(p)))
  } catch (err) {
    console.error("Failed to bootstrap instance", err)
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: `Failed to reload ${project}`,
      description: formatServerError(err, input.translate),
    })
    input.setStore("status", "partial")
    perfLog("directory.bootstrap", {
      directory: input.directory,
      warm,
      durationMs: perfDuration(start),
      ok: false,
      phase: "blocking",
    })
    return
  }

  if (input.store.status !== "complete") input.setStore("status", "partial")
  const backgroundRequests = [
    request("background", "path", () => input.sdk.path.get().then((x) => input.setStore("path", reconcile(x.data!)))),
    request("background", "command.list", () =>
      // OCO: Command has a stable `name`; keyed reconcile preserves identity.
      input.sdk.command.list().then((x) => input.setStore("command", reconcile(x.data ?? [], { key: "name" }))),
    ),
    request("background", "session.status", () =>
      input.sdk.session.status().then((x) => input.setStore("session_status", reconcile(x.data!))),
    ),
    request("background", "session.list", () => Promise.resolve(input.loadSessions(input.directory))),
    request("background", "mcp.status", () =>
      input.sdk.mcp.status().then((x) => input.setStore("mcp", reconcile(x.data!))),
    ),
    request("background", "lsp.status", () =>
      input.sdk.lsp.status().then((x) => input.setStore("lsp", reconcile(x.data!))),
    ),
    request("background", "vcs.get", () =>
      input.sdk.vcs.get().then((x) => {
        const next = x.data ?? input.store.vcs
        input.setStore("vcs", reconcile(next))
        if (next?.branch) input.vcsCache.setStore("value", next)
      }),
    ),
    request("background", "permission.list", () =>
      input.sdk.permission.list().then((x) => {
        const grouped = groupBySession(
          (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
        )
        batch(() => {
          for (const sessionID of Object.keys(input.store.permission)) {
            if (grouped[sessionID]) continue
            input.setStore("permission", sessionID, [])
          }
          for (const [sessionID, permissions] of Object.entries(grouped)) {
            input.setStore(
              "permission",
              sessionID,
              reconcile(
                permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                { key: "id" },
              ),
            )
          }
        })
      }),
    ),
    request("background", "question.list", () =>
      input.sdk.question.list().then((x) => {
        const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
        batch(() => {
          for (const sessionID of Object.keys(input.store.question)) {
            if (grouped[sessionID]) continue
            input.setStore("question", sessionID, [])
          }
          for (const [sessionID, questions] of Object.entries(grouped)) {
            input.setStore(
              "question",
              sessionID,
              reconcile(
                questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                { key: "id" },
              ),
            )
          }
        })
      }),
    ),
  ]
  perfLog("directory.bootstrap.partial", {
    directory: input.directory,
    warm,
    durationMs: perfDuration(start),
    requests: Object.keys(blockingRequests).length,
  })

  Promise.all(backgroundRequests).then(() => {
    input.setStore("status", "complete")
    perfLog("directory.bootstrap.complete", {
      directory: input.directory,
      warm,
      durationMs: perfDuration(start),
      requests: backgroundRequests.length,
    })
  })
}
