import type {
  AnalyticsBreakdownRow,
  AnalyticsCostBuckets,
  AnalyticsEstimatedCost,
  AnalyticsPricingGap,
  AnalyticsProjectOption,
  AnalyticsResponseRow,
  AnalyticsSessionRow,
  AnalyticsSummary,
  AnalyticsTokenTotals,
  AnalyticsTotals,
} from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate, useSearchParams } from "@solidjs/router"
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  onCleanup,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { analyticsIsProgressSummary, analyticsRenderPlan, type AnalyticsRenderPlan } from "./analytics-helpers"

type Period = AnalyticsSummary["period"]

type AnalyticsMain = AnalyticsRenderPlan["main"]
type AnalyticsMainOfKind<K extends AnalyticsMain["kind"]> = Extract<AnalyticsMain, { kind: K }>

/**
 * Reactive Switch/Match helper: returns an accessor that resolves to the `main` variant
 * when it matches the requested kind, otherwise `undefined`. Returning an accessor keeps
 * Match reactive even though we are reaching into the render plan through a helper, and
 * returning `undefined` (not `false`) lets Solid's child-callback narrowing remove the
 * empty case so consumers can read variant fields without a manual cast.
 */
function mainOfKind<K extends AnalyticsMain["kind"]>(
  plan: () => AnalyticsRenderPlan,
  kind: K,
): () => AnalyticsMainOfKind<K> | undefined {
  return () => {
    const main = plan().main
    return main.kind === kind ? (main as AnalyticsMainOfKind<K>) : undefined
  }
}

type View = "tokens" | "cost"

type Filters = {
  // `project` is intentionally NOT here — the project filter is the dropdown state
  // (`projectFilter`), and clicks on a project breakdown row update that dropdown.
  // This keeps the cache key, the URL, and the chip bar all consistent.
  model?: string
  agent?: string
  day?: string
}

type Bucket = "freshInput" | "output" | "reasoning" | "cacheRead" | "cacheWrite"

const periods: Array<{ value: Period; label: string; short: string }> = [
  { value: "today", label: "Today", short: "Today" },
  { value: "7d", label: "7 days", short: "7d" },
  { value: "30d", label: "30 days", short: "30d" },
  { value: "thisMonth", label: "This month", short: "Month" },
  { value: "allTime", label: "All time", short: "All" },
]

// Stable token-bucket palette. Used identically in the time-series stack, KPI strip
// composition bar, and any breakdown that decomposes by bucket — so the eye learns the
// language once. Keep these in sync with the order in `buckets`.
const bucketColor: Record<Bucket, string> = {
  freshInput: "#f59f00", // warm — fresh input is the costly thing
  output: "#3aae6f", // green — output
  reasoning: "#5b9cf2", // blue — reasoning
  cacheRead: "#a98cff", // purple — cache hits
  cacheWrite: "#ff7e7e", // red — cache writes
}

const bucketLabel: Record<Bucket, string> = {
  freshInput: "Fresh input",
  output: "Output",
  reasoning: "Reasoning",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
}

const buckets: Bucket[] = ["freshInput", "output", "reasoning", "cacheRead", "cacheWrite"]

// In-memory summary cache keyed by full filter combo so reopening Analytics within the
// same app session is near-instant. Refresh on filter change or explicit refresh.
type CacheEntry = { value: AnalyticsSummary; at: number }
const summaryCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes — fresh enough to be honest, slow enough to be snappy

const currency = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 })
const integerFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const percentFmt = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 })

export default function AnalyticsPage() {
  const sdk = useGlobalSDK()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [period, setPeriod] = createSignal<Period>((search.period as Period) || "30d")
  const [projectFilter, setProjectFilter] = createSignal<string | undefined>(
    typeof search.project === "string" ? search.project : undefined,
  )
  // Local cross-filter state for dimensions that don't have a top-level UI affordance.
  // The project filter is owned by `projectFilter()` (dropdown + project breakdown clicks)
  // so clicks on the project distribution panel narrow the same way the dropdown does.
  const [filters, setFilters] = createSignal<Filters>({})
  const [view, setView] = createSignal<View>("tokens")
  const [explicitRebuild, setExplicitRebuild] = createSignal(false)
  // Manual refresh is the only thing that briefly fades the dashboard. Automatic polling
  // during catch-up flips `summary.loading` every second; we deliberately ignore that here
  // so the dashboard does not pulse on every poll.
  const [manualRefreshing, setManualRefreshing] = createSignal(false)

  const fullCacheKey = createMemo(() => {
    const f = filters()
    return [period(), projectFilter() ?? "", f.model ?? "", f.agent ?? "", f.day ?? ""].join("|")
  })

  const cacheLookup = createMemo(() => {
    const entry = summaryCache.get(fullCacheKey())
    if (!entry) return undefined
    if (Date.now() - entry.at > CACHE_TTL_MS) return undefined
    return entry.value
  })

  const source = createMemo(() => ({
    period: period(),
    project: projectFilter(),
    model: filters().model,
    agent: filters().agent,
    day: filters().day,
  }))
  const [summary, actions] = createResource(source, async (q) => {
    const key = [q.period, q.project ?? "", q.model ?? "", q.agent ?? "", q.day ?? ""].join("|")
    const cached = summaryCache.get(key)
    if (cached && Date.now() - cached.at <= CACHE_TTL_MS) return cached.value
    const result = await sdk.client.global.analytics({
      period: q.period,
      project: q.project || undefined,
      model: q.model || undefined,
      agent: q.agent || undefined,
      day: q.day || undefined,
    })
    if (!result.data) throw new Error("Analytics summary was empty")
    if (!result.data.backfilling && !result.data.recalculating) summaryCache.set(key, { value: result.data, at: Date.now() })
    return result.data
  })

  // The latest *non-progress* summary we have seen. Unlike Solid's `summary.latest`,
  // this does not get overwritten when the server starts returning progress-marked
  // payloads (catch-up or explicit rebuild). It is the fallback the dashboard reads
  // from while a background catch-up or rebuild is in flight, so trustworthy prior
  // data stays on screen even after fresh progress responses arrive.
  const [latestTrustworthy, setLatestTrustworthy] = createSignal<AnalyticsSummary | undefined>(undefined)

  createEffect(() => {
    if (!summary()?.backfilling && !summary()?.recalculating) return
    const timer = setInterval(() => actions.refetch(), 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const current = summary()
    if (current && !analyticsIsProgressSummary(current)) {
      setExplicitRebuild(false)
      setLatestTrustworthy(current)
    }
  })

  // Clear the manual-refresh signal as soon as the in-flight request settles. The button
  // sets it true; this effect is the only thing that flips it back to false.
  createEffect(() => {
    if (!summary.loading && manualRefreshing()) setManualRefreshing(false)
  })

  const filtersAreNarrowed = createMemo(() => {
    const f = filters()
    return !!(projectFilter() || period() !== "allTime" || f.model || f.agent || f.day)
  })

  const renderPlan = createMemo(() =>
    analyticsRenderPlan({
      current: summary(),
      latestTrustworthy: latestTrustworthy(),
      latestRaw: summary.latest,
      hasError: !!summary.error,
      loading: summary.loading,
      manualRefreshInFlight: manualRefreshing(),
      explicitRebuild: explicitRebuild(),
      filtersAreNarrowed: filtersAreNarrowed(),
    }),
  )

  // Pre-built per-kind accessors so JSX `when` props get a properly narrowed value at the
  // call site. Solid narrows the child callback's accessor based on `NonNullable<T>`, so
  // we deliberately return `undefined` (not `false`) for misses.
  const mainLoading = mainOfKind(renderPlan, "loading")
  const mainErrorOnly = mainOfKind(renderPlan, "errorOnly")
  const mainErrorWithStale = mainOfKind(renderPlan, "errorWithStale")
  const mainEmpty = mainOfKind(renderPlan, "empty")
  const mainFullProgress = mainOfKind(renderPlan, "fullProgress")
  const mainDashboard = mainOfKind(renderPlan, "dashboard")

  function updatePeriod(next: Period) {
    setPeriod(next)
    setSearch({ period: next })
    setFilters((f) => ({ ...f, day: undefined }))
  }

  function updateProjectFilter(next: string | undefined) {
    batch(() => {
      setProjectFilter(next)
      setSearch({ project: next })
    })
  }

  /** Clicks on a project breakdown row → toggle the dropdown filter (so chip + cache key stay consistent). */
  function toggleProjectFilter(id: string) {
    if (projectFilter() === id) updateProjectFilter(undefined)
    else updateProjectFilter(id)
  }

  function refresh() {
    // Drop our cached summary for this filter combo and force a fresh fetch. We flip the
    // manual-refresh signal so the dashboard briefly dims as user-action acknowledgement.
    // The dim signal is independent of `summary.loading` so polling never fades the UI.
    summaryCache.delete(fullCacheKey())
    setManualRefreshing(true)
    actions.refetch()
  }

  async function rebuild() {
    // Clear all cached summaries and trigger a server-side rebuild.
    summaryCache.clear()
    setExplicitRebuild(true)
    try {
      await sdk.client.global.analyticsRebuild()
    } catch {
      // Network errors are non-fatal — the next refetch will pick up the backfilling state.
    }
    actions.refetch()
  }

  function toggleFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? undefined : value }))
  }

  function clearFilter<K extends keyof Filters>(key: K) {
    setFilters((f) => ({ ...f, [key]: undefined }))
  }

  function clearAllFilters() {
    batch(() => {
      setFilters({})
      updateProjectFilter(undefined)
    })
  }

  function openSession(row: AnalyticsSessionRow | AnalyticsResponseRow) {
    const href = `/${base64Encode(row.directory)}/session/${row.sessionID}`
    navigate(href)
  }

  return (
    <div class="size-full overflow-y-auto bg-background-base text-text-base">
      {/* Page-scoped keyframes used by LoadingPanel. Mounted once with the page so the
          indicator animates without depending on which body variant is currently shown. */}
      <style>
        {`@keyframes oco-analytics-loading {
          0% { transform: translateX(-110%); }
          50% { transform: translateX(120%); }
          100% { transform: translateX(360%); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .oco-analytics-settle {
            transition: opacity 180ms ease, transform 180ms ease;
          }
          .oco-analytics-settle[data-refreshing="true"] {
            opacity: 0.72;
            transform: translateY(1px);
          }
          .oco-analytics-chart-bars rect {
            transition: y 180ms ease, height 180ms ease, opacity 180ms ease;
          }
          .oco-analytics-bar-group {
            transition: opacity 150ms ease;
          }
          .oco-analytics-period-tab {
            transition: color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .oco-analytics-settle,
          .oco-analytics-bar-group,
          .oco-analytics-chart-bars rect,
          .oco-analytics-period-tab,
          .oco-analytics-loading-bar,
          .oco-analytics-progress-fill {
            animation: none !important;
            transition: none !important;
            transform: none !important;
          }
        }`}
      </style>
      <div class="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-4 md:px-6 md:py-6">
        <Header
          period={period}
          onUpdatePeriod={updatePeriod}
          projectFilter={projectFilter}
          availableProjects={() => renderPlan().displayed?.availableProjects ?? []}
          onUpdateProject={updateProjectFilter}
          onRefresh={refresh}
          onRebuild={rebuild}
          // The header refresh/rebuild controls disable on explicit user-action only, not
          // on every background polling cycle. This stops the buttons from flickering
          // enabled/disabled every second during catch-up.
          busy={() => manualRefreshing() || explicitRebuild()}
          generatedAt={() => renderPlan().displayed?.generatedAt}
          cached={() => cacheLookup() !== undefined}
        />

        <ActiveFilterBar
          filters={filters}
          projectFilter={projectFilter}
          onClearProject={() => updateProjectFilter(undefined)}
          onClearOne={clearFilter}
          onClearAll={clearAllFilters}
          projectLabel={(id) => renderPlan().displayed?.availableProjects.find((p) => p.id === id)?.label ?? id}
        />

        {/* One quiet status strip while a non-blocking catch-up or rebuild is in progress.
            It stays mounted across polling cycles — we deliberately do not condition this
            on `summary.loading`, otherwise it would mount/unmount on every poll and flash.
            The strip reads progress from the live `summary()` (the actual progress-marked
            response) while the dashboard underneath still uses `summary.latest`. */}
        <Show when={renderPlan().showCatchupStrip}>
          <CatchupProgressStrip summary={summary} rebuilding={() => renderPlan().catchupRebuildLabel} />
        </Show>
        <Switch>
          <Match when={mainLoading()}>
            <LoadingPanel />
          </Match>
          <Match when={mainErrorOnly()}>
            <StatePanel
              title="Analytics could not load"
              body="The local server returned an error while building the summary."
              action={<Button onClick={() => refresh()}>Retry</Button>}
            />
          </Match>
          {/* OCO: NOT keyed — `analyticsRenderPlan` returns a fresh wrapper
              object on every memo run (every 1s during catch-up polling). Keyed
              would tear down <Dashboard> each tick. Non-keyed is safe here
              because the `when` is a deterministic memo over a discriminated
              union — the `kind` discriminator never goes partial mid-batch, so
              the Show/Match stale-read cliff doesn't apply. */}
          <Match when={mainErrorWithStale()}>
            {(plan) => (
              <>
                <div class="flex items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-50/10 px-3 py-2 text-sm text-amber-400">
                  <span>Refresh failed — showing stale data.</span>
                  <button class="underline hover:text-amber-300" onClick={() => refresh()}>
                    Retry
                  </button>
                </div>
                <Dashboard
                  summary={plan().summary}
                  filters={filters}
                  projectFilter={projectFilter}
                  toggleFilter={toggleFilter}
                  toggleProjectFilter={toggleProjectFilter}
                  view={view}
                  setView={setView}
                  openSession={openSession}
                  refreshing={() => false}
                />
              </>
            )}
          </Match>
          <Match when={mainEmpty()}>
            <StatePanel
              title="No usage yet in this scope"
              body="There are no assistant responses in the selected period and project. Try a longer period or clear the project filter."
              action={
                <Show when={filtersAreNarrowed()}>
                  <Button
                    onClick={() => {
                      updatePeriod("allTime")
                      updateProjectFilter(undefined)
                    }}
                  >
                    Show all time, all projects
                  </Button>
                </Show>
              }
            />
          </Match>
          {/* OCO: see comment on mainErrorWithStale above — not keyed by design. */}
          <Match when={mainFullProgress()}>
            {(plan) => (
              <BackfillProgressPanel
                total={plan().total}
                processed={plan().processed}
                recalculating={plan().recalculating}
                rebuilding={plan().rebuilding}
              />
            )}
          </Match>
          <Match when={mainDashboard()}>
            {(plan) => (
              <Dashboard
                summary={plan().summary}
                filters={filters}
                projectFilter={projectFilter}
                toggleFilter={toggleFilter}
                toggleProjectFilter={toggleProjectFilter}
                view={view}
                setView={setView}
                openSession={openSession}
                refreshing={() => plan().dim}
              />
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function Header(props: {
  period: () => Period
  onUpdatePeriod: (next: Period) => void
  projectFilter: () => string | undefined
  availableProjects: () => AnalyticsProjectOption[]
  onUpdateProject: (next: string | undefined) => void
  onRefresh: () => void
  onRebuild: () => void
  /** True while a user-initiated refresh or rebuild is in flight. Polling never sets this. */
  busy: () => boolean
  generatedAt: () => number | undefined
  cached: () => boolean
}) {
  const projectLabel = createMemo(() => {
    const id = props.projectFilter()
    if (!id) return "All projects"
    const found = props.availableProjects().find((p) => p.id === id)
    return found?.label ?? "All projects"
  })

  const lastFetchedLabel = createMemo(() => {
    const at = props.generatedAt()
    if (!at) return undefined
    const seconds = Math.round((Date.now() - at) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
    return new Date(at).toLocaleTimeString()
  })

  return (
    <div class="flex flex-col gap-3 rounded-[18px] border border-border-weaker-base bg-background-stronger p-4 shadow-xs-border-base">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center gap-2 text-12-medium uppercase tracking-[0.18em] text-text-weak">
            <Icon name="analytics" size="small" /> OCO Analytics
          </div>
          <h1 class="text-22-medium text-text-strong md:text-24-medium">Local usage</h1>
        </div>
        <div class="flex flex-nowrap items-center gap-2 self-start md:self-auto">
          <DropdownMenu placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              class="inline-flex items-center gap-1.5 rounded-lg border border-border-weaker-base bg-surface-base px-3 py-1.5 text-12-medium text-text-strong hover:bg-surface-raised-base-hover"
              aria-label="Filter by project"
            >
              <span class="max-w-[180px] truncate">{projectLabel()}</span>
              <Icon name="chevron-down" size="small" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <ProjectMenu
                projects={props.availableProjects}
                active={props.projectFilter}
                onSelect={props.onUpdateProject}
              />
            </DropdownMenu.Portal>
          </DropdownMenu>
          <Tooltip value={props.cached() ? `Cached · ${lastFetchedLabel() ?? "now"}` : `Refreshed ${lastFetchedLabel() ?? "now"}`}>
            <IconButton
              icon="reset"
              variant="ghost"
              size="normal"
              onClick={props.onRefresh}
              aria-label="Refresh analytics"
              disabled={props.busy()}
            />
          </Tooltip>
          <Tooltip value="Clear summary cache and rebuild from scratch">
            <IconButton
              icon="reset"
              variant="ghost"
              size="small"
              onClick={props.onRebuild}
              aria-label="Rebuild summary cache"
              disabled={props.busy()}
              class="opacity-50 hover:opacity-100"
            />
          </Tooltip>
        </div>
      </div>
      <PeriodPills value={props.period} onSelect={props.onUpdatePeriod} />
    </div>
  )
}

function PeriodPills(props: { value: () => Period; onSelect: (period: Period) => void }) {
  return (
    <div
      class="flex flex-nowrap items-center gap-1 self-start overflow-hidden rounded-xl bg-surface-base p-1"
      role="tablist"
    >
      <For each={periods}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value() === item.value}
            class="oco-analytics-period-tab shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-12-medium outline-none focus-visible:ring-2 focus-visible:ring-text-strong focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            classList={{
              "bg-surface-raised-base text-text-strong shadow-xs-border-base": props.value() === item.value,
              "text-text-base hover:text-text-strong": props.value() !== item.value,
            }}
            onClick={() => props.onSelect(item.value)}
          >
            <span class="hidden sm:inline">{item.label}</span>
            <span class="sm:hidden">{item.short}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function ProjectMenu(props: {
  projects: () => AnalyticsProjectOption[]
  active: () => string | undefined
  onSelect: (id: string | undefined) => void
}) {
  return (
    <DropdownMenu.Content class="max-h-[420px] w-72 overflow-y-auto rounded-xl border border-border-weaker-base bg-surface-raised-base p-1 shadow-md-base">
      <DropdownMenu.Item
        class="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-13-medium text-text-strong hover:bg-surface-base-hover"
        onSelect={() => props.onSelect(undefined)}
      >
        <span>All projects</span>
        <Show when={!props.active()}>
          <Icon name="check" size="small" />
        </Show>
      </DropdownMenu.Item>
      <For each={props.projects()}>
        {(project) => (
          <DropdownMenu.Item
            class="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-13-regular text-text-base hover:bg-surface-base-hover"
            onSelect={() => props.onSelect(project.id)}
          >
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-text-strong">{project.label}</span>
              <span class="truncate text-11-regular text-text-weak">{project.directory}</span>
            </span>
            <span class="ml-3 flex items-center gap-1.5 text-11-regular text-text-weak">
              <span>{integerFmt.format(project.calls)}</span>
              <Show when={props.active() === project.id}>
                <Icon name="check" size="small" />
              </Show>
            </span>
          </DropdownMenu.Item>
        )}
      </For>
    </DropdownMenu.Content>
  )
}

function ActiveFilterBar(props: {
  filters: () => Filters
  projectFilter: () => string | undefined
  onClearProject: () => void
  onClearOne: <K extends keyof Filters>(key: K) => void
  onClearAll: () => void
  projectLabel: (id: string) => string
}) {
  type Chip =
    | { kind: "filter"; key: keyof Filters; label: string }
    | { kind: "project"; label: string }
  const chips = createMemo(() => {
    const f = props.filters()
    const out: Chip[] = []
    if (f.day) out.push({ kind: "filter", key: "day", label: `day: ${f.day}` })
    const projectId = props.projectFilter()
    if (projectId) out.push({ kind: "project", label: `project: ${props.projectLabel(projectId)}` })
    if (f.model) out.push({ kind: "filter", key: "model", label: `model: ${f.model}` })
    if (f.agent) out.push({ kind: "filter", key: "agent", label: `agent: ${f.agent}` })
    return out
  })
  return (
    <Show when={chips().length > 0}>
      <div class="flex flex-wrap items-center gap-2 rounded-xl border border-border-weaker-base bg-surface-base px-3 py-2 text-12-medium">
        <span class="text-text-weak">Filters:</span>
        <For each={chips()}>
          {(chip) => (
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-background-stronger px-2 py-0.5 text-text-strong hover:bg-surface-raised-base-hover"
              onClick={() => (chip.kind === "project" ? props.onClearProject() : props.onClearOne(chip.key))}
            >
              <span class="max-w-[260px] truncate">{chip.label}</span>
              <Icon name="close-small" size="small" />
            </button>
          )}
        </For>
        <button
          type="button"
          class="ml-auto rounded-md px-2 py-0.5 text-text-weak hover:text-text-strong"
          onClick={props.onClearAll}
        >
          Clear all
        </button>
      </div>
    </Show>
  )
}

function LoadingPanel() {
  return (
    <div
      role="status"
      aria-live="polite"
      class="flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-[18px] border border-border-weaker-base bg-surface-base p-8 text-center shadow-xs-border-base"
    >
      <div class="flex h-2 w-64 max-w-full overflow-hidden rounded-full bg-background-base">
        <div
          class="oco-analytics-loading-bar h-full w-1/3 rounded-full bg-[#f59f00]"
          style={{ animation: "oco-analytics-loading 1.4s ease-in-out infinite" }}
        />
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">Scanning local history…</div>
        <div class="text-12-regular text-text-weak">First load reads assistant rows from local storage. Repeat opens are instant.</div>
      </div>
    </div>
  )
}

function CatchupProgressStrip(props: { summary: () => AnalyticsSummary | undefined; rebuilding: () => boolean }) {
  const progress = createMemo(() => props.summary()?.backfilling ?? props.summary()?.recalculating)
  const label = createMemo(() => {
    const current = progress()
    const prefix = props.rebuilding() ? "Rebuilding summary cache" : "Catching up local history"
    if (!current || current.total <= 0) return `${prefix}...`
    return `${prefix}: ${compactFmt.format(current.processed)} / ${compactFmt.format(current.total)} messages`
  })
  return (
    <div
      role="status"
      aria-live="polite"
      data-analytics-catchup-strip
      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-weaker-base bg-surface-base px-3 py-2 text-12-regular text-text-base"
    >
      <span class="text-text-weak">{label()}</span>
      <span class="rounded-full bg-background-stronger px-2 py-0.5 text-11-medium uppercase tracking-[0.12em] text-text-weak">
        {props.rebuilding() ? "Rebuild in progress" : "Dashboard stays live"}
      </span>
    </div>
  )
}

function StatePanel(props: { title: string; body: string; action?: JSX.Element }) {
  return (
    <div class="flex min-h-[360px] flex-col items-center justify-center rounded-[18px] border border-border-weaker-base bg-surface-base p-8 text-center shadow-xs-border-base">
      <Icon name="analytics" size="large" />
      <div class="mt-4 text-18-medium text-text-strong">{props.title}</div>
      <div class="mt-2 max-w-md text-13-regular text-text-base">{props.body}</div>
      <Show when={props.action}>
        <div class="mt-4">{props.action}</div>
      </Show>
    </div>
  )
}

function BackfillProgressPanel(props: { total: number; processed: number; recalculating?: boolean; rebuilding?: boolean }) {
  const percent = createMemo(() => {
    if (props.total <= 0) return 0
    return Math.min(100, Math.round((props.processed / props.total) * 100))
  })
  const title = createMemo(() => {
    if (props.recalculating) return "Recalculating historical token totals…"
    if (props.rebuilding) return "Rebuilding summary cache…"
    return "Building summary cache…"
  })
  const body = createMemo(() => {
    if (props.recalculating) return "Correcting prior tool-loop token totals from stored step records."
    if (props.rebuilding) return "Replaying local history into a fresh summary cache."
    return "Processing"
  })
  const tail = createMemo(() => {
    if (props.recalculating) return " Normal analytics resumes when this finishes."
    if (props.rebuilding) return " The rest of the app stays usable while the rebuild runs."
    return " The rest of the app stays usable while this runs."
  })
  return (
    <div
      role="status"
      aria-live="polite"
      data-analytics-full-progress
      class="flex min-h-[360px] flex-col items-center justify-center gap-5 rounded-[18px] border border-border-weaker-base bg-surface-base p-8 text-center shadow-xs-border-base"
    >
      <div class="flex h-2.5 w-72 max-w-full overflow-hidden rounded-full bg-background-base">
        <div
          class="oco-analytics-progress-fill h-full rounded-full bg-[#f59f00] transition-all duration-300 ease-out"
          style={{ width: `${percent()}%` }}
        />
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">{title()}</div>
        <div class="text-12-regular text-text-weak">
          {body()} {compactFmt.format(props.processed)} of {compactFmt.format(props.total)} messages.{tail()}
        </div>
      </div>
    </div>
  )
}

function Dashboard(props: {
  summary: AnalyticsSummary
  filters: () => Filters
  projectFilter: () => string | undefined
  toggleFilter: <K extends keyof Filters>(key: K, value: string) => void
  toggleProjectFilter: (id: string) => void
  view: () => View
  setView: (v: View) => void
  openSession: (row: AnalyticsSessionRow | AnalyticsResponseRow) => void
  refreshing: () => boolean
}) {
  // Project, model, agent, and day filters are sent through to the server (the source
  // memo carries them into `client.global.analytics(...)`), so KPIs / chart / breakdowns /
  // high-impact lists all reflect the active filter set. The exclude-self semantic on the
  // backend means each breakdown panel still shows every member of its own dimension so
  // the user can switch focus without first clearing a chip.

  const totals = () => props.summary.totals

  return (
    <div
      class="oco-analytics-settle flex flex-col gap-5"
      data-analytics-dashboard
      data-refreshing={props.refreshing() ? "true" : "false"}
    >
      <KpiStrip totals={totals} refreshing={props.refreshing} />

      <TimeSeriesChart
        rows={() => props.summary.breakdowns.byBucket}
        view={props.view}
        setView={props.setView}
        activeDay={() => props.filters().day}
        onPickDay={(day) => props.toggleFilter("day", day)}
        refreshing={props.refreshing}
      />

      <PricingCoveragePanel coverage={() => props.summary.coverage} />

      <div class="grid gap-3 lg:grid-cols-3">
        <DistributionPanel
          title="By model / provider"
          rows={() => props.summary.breakdowns.byModel}
          activeId={() => props.filters().model}
          onPick={(id) => props.toggleFilter("model", id)}
          view={props.view}
          limit={10}
        />
        <DistributionPanel
          title="By project"
          rows={() => props.summary.breakdowns.byProject}
          activeId={props.projectFilter}
          onPick={props.toggleProjectFilter}
          view={props.view}
          // Show every project with usage — never truncate. Spec: "every project with usage in the selected period".
          limit={undefined}
        />
        <DistributionPanel
          title="By agent"
          rows={() => props.summary.breakdowns.byAgent}
          activeId={() => props.filters().agent}
          onPick={(id) => props.toggleFilter("agent", id)}
          view={props.view}
          limit={10}
        />
      </div>

      <HighImpactPanel
        sessions={() => props.summary.highImpact.sessions}
        responses={() => props.summary.highImpact.responses}
        openSession={props.openSession}
      />
    </div>
  )
}

function KpiStrip(props: { totals: () => AnalyticsTotals; refreshing: () => boolean }) {
  return (
    <div
      class="oco-analytics-settle grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      data-analytics-kpi-strip
      data-refreshing={props.refreshing() ? "true" : "false"}
    >
      <Kpi
        label="API-equivalent"
        value={formatEstimate(props.totals().apiEquivalentCost)}
        tone="warm"
        sub={
          <Show when={props.totals().apiEquivalentCost.unknownResponses > 0}>
            <span class="text-text-warning">partial</span>
          </Show>
        }
      />
      <Kpi label="Actual cost" value={currency.format(props.totals().actualCost)} />
      <Kpi label="Model calls" value={integerFmt.format(props.totals().calls)} />
      <Kpi label="Sessions" value={integerFmt.format(props.totals().sessions)} />
      <KpiTokens tokens={props.totals().tokens} />
      <Kpi
        label="Cache hit rate"
        value={percentFmt.format(props.totals().cacheHitRate)}
        sub={`${compactFmt.format(props.totals().tokens.cacheRead)} / ${compactFmt.format(props.totals().tokens.cacheRead + props.totals().tokens.freshInput)}`}
      />
    </div>
  )
}

function Kpi(props: { label: string; value: string; sub?: JSX.Element | string; tone?: "warm" }) {
  return (
    <section
      class="relative overflow-hidden rounded-[14px] border border-border-weaker-base bg-surface-base p-3 shadow-xs-border-base"
      classList={{ "bg-[linear-gradient(135deg,rgba(245,159,0,0.18),rgba(255,255,255,0)_56%)]": props.tone === "warm" }}
    >
      <div class="text-11-medium uppercase tracking-[0.14em] text-text-weak">{props.label}</div>
      <div class="mt-1.5 text-20-medium text-text-strong">{props.value}</div>
      <Show when={props.sub}>
        <div class="mt-1 text-11-regular text-text-weak">{props.sub}</div>
      </Show>
    </section>
  )
}

function KpiTokens(props: { tokens: AnalyticsTokenTotals }) {
  const segments = createMemo(() => {
    const total = Math.max(props.tokens.total, 1)
    return buckets.map((b) => ({ key: b, value: props.tokens[b], pct: (props.tokens[b] / total) * 100 }))
  })
  return (
    <section class="relative overflow-hidden rounded-[14px] border border-border-weaker-base bg-surface-base p-3 shadow-xs-border-base">
      <div class="text-11-medium uppercase tracking-[0.14em] text-text-weak">Tokens</div>
      <div class="mt-1.5 text-20-medium text-text-strong">{compactFmt.format(props.tokens.total)}</div>
      <div class="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-background-base">
        <For each={segments()}>
          {(s) => (
            <Tooltip value={`${bucketLabel[s.key]}: ${integerFmt.format(s.value)}`}>
              <div class="h-full" style={{ width: `${s.pct}%`, "background-color": bucketColor[s.key] }} />
            </Tooltip>
          )}
        </For>
      </div>
    </section>
  )
}

function TimeSeriesChart(props: {
  rows: () => AnalyticsBreakdownRow[]
  view: () => View
  setView: (v: View) => void
  activeDay: () => string | undefined
  onPickDay: (day: string) => void
  refreshing: () => boolean
}) {
  const sorted = createMemo(() => [...props.rows()].sort((a, b) => a.id.localeCompare(b.id)))
  const data = createMemo(() => {
    const isCost = props.view() === "cost"
    return sorted().map((row) => {
      const segments = buckets.map((b) => ({
        key: b,
        value: isCost ? row.apiEquivalentCostBuckets[b].amount : row.tokens[b],
      }))
      const total = segments.reduce((acc, s) => acc + s.value, 0)
      const day = row.day ?? row.id.slice(0, 10)
      return { id: row.id, label: row.label, day, total, segments, raw: row }
    })
  })
  const max = createMemo(() => Math.max(...data().map((d) => d.total), 1))
  const [hover, setHover] = createSignal<number | undefined>(undefined)

  // Chart geometry. We render an SVG with a y-axis baseline + 4 horizontal gridlines
  // and per-day stacked rectangles. An invisible HTML overlay mirrors the bar grid for
  // hover/click interactivity (so we get keyboard focus, focus rings, and tooltips
  // without juggling per-segment SVG event handlers).
  const chartHeight = 220
  const gridLines = 4
  const gap = 6

  const labelEvery = createMemo(() => {
    const n = data().length
    if (n <= 8) return 1
    if (n <= 16) return 2
    if (n <= 32) return 4
    if (n <= 64) return 7
    return Math.ceil(n / 12)
  })

  const yTicks = createMemo(() => {
    const m = max()
    return Array.from({ length: gridLines + 1 }, (_, i) => (m * i) / gridLines)
  })

  return (
    <section
      class="oco-analytics-settle rounded-[16px] border border-border-weaker-base bg-surface-base p-4 shadow-xs-border-base"
      data-analytics-chart
      data-refreshing={props.refreshing() ? "true" : "false"}
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col">
          <div class="text-14-medium text-text-strong">Usage over time</div>
          <div class="text-12-regular text-text-weak">Click a bar to filter every panel below to its day</div>
        </div>
        <div class="flex items-center gap-1 rounded-lg bg-background-base p-0.5">
          <ChartViewToggle value={props.view} setValue={props.setView} />
        </div>
      </div>

      <Show
        when={data().length > 0}
        fallback={
          <div class="mt-6 flex h-48 items-center justify-center text-12-regular text-text-weak">
            Nothing to chart in this scope yet.
          </div>
        }
      >
        <div class="relative mt-4 flex">
          {/* Y-axis ticks */}
          <div
            class="flex shrink-0 flex-col-reverse justify-between pr-2 text-10-regular text-text-weak tabular-nums"
            style={{ height: `${chartHeight}px` }}
          >
            <For each={yTicks()}>
              {(tick) => <span class="leading-none">{formatViewValue(tick, props.view())}</span>}
            </For>
          </div>

          {/* Chart body: SVG bars + HTML overlay for interactivity */}
          <div class="relative flex-1 min-w-0">
            <svg
              role="img"
              aria-label={`Stacked bar chart showing usage over time as ${props.view()}`}
              viewBox={`0 0 ${Math.max(data().length, 1) * 100} ${chartHeight}`}
              preserveAspectRatio="none"
              class="block w-full"
              style={{ height: `${chartHeight}px` }}
            >
              {/* Horizontal gridlines */}
              <For each={Array.from({ length: gridLines + 1 }, (_, i) => i)}>
                {(i) => {
                  const y = (chartHeight * i) / gridLines
                  return (
                    <line
                      x1={0}
                      x2={Math.max(data().length, 1) * 100}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      stroke-width={1}
                      stroke-opacity={i === gridLines ? 0.35 : 0.1}
                      class="text-text-weak"
                      vector-effect="non-scaling-stroke"
                    />
                  )
                }}
              </For>
              {/* Stacked bar rectangles per day */}
              <For each={data()}>
                {(d, i) => {
                  const x = i() * 100 + gap / 2
                  const w = 100 - gap
                  const segs = createMemo(() => {
                    let cursor = chartHeight
                    return d.segments.map((s) => {
                      const h = max() === 0 ? 0 : (s.value / max()) * chartHeight
                      const y = cursor - h
                      cursor = y
                      return { ...s, x, y, w, h }
                    })
                  })
                  const isActive = () => props.activeDay() === d.day
                  const isHover = () => hover() === i()
                  const fade = () => props.activeDay() !== undefined && !isActive() && !isHover()
                  return (
                    <g class="oco-analytics-bar-group oco-analytics-chart-bars" style={{ opacity: fade() ? 0.45 : 1 }}>
                      <For each={segs()}>
                        {(s) => (
                          <Show when={s.h > 0}>
                            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={bucketColor[s.key]} />
                          </Show>
                        )}
                      </For>
                      <Show when={isActive()}>
                        <rect
                          x={x - 1}
                          y={0}
                          width={w + 2}
                          height={chartHeight}
                          fill="none"
                          stroke="currentColor"
                          stroke-width={1.5}
                          stroke-opacity={0.85}
                          class="text-text-strong"
                          vector-effect="non-scaling-stroke"
                        />
                      </Show>
                    </g>
                  )
                }}
              </For>
            </svg>

            {/* Interactive overlay: one button per day */}
            <div
              class="absolute inset-0 flex"
              style={{ height: `${chartHeight}px`, gap: `${gap}px` }}
            >
              <For each={data()}>
                {(d, i) => {
                  const isActive = () => props.activeDay() === d.day
                  const isHover = () => hover() === i()
                  const ariaLabel = createMemo(() => {
                    const view = props.view()
                    const parts = [`${d.label}: ${formatViewValue(d.total, view)}`]
                    const buckets = d.segments
                      .filter((s) => s.value > 0)
                      .map((s) => `${bucketLabel[s.key]} ${formatViewValue(s.value, view)}`)
                    if (buckets.length > 0) parts.push(buckets.join(", "))
                    if (d.raw.topModel) parts.push(`Top model ${d.raw.topModel.label}`)
                    if (d.raw.topProject) parts.push(`Top project ${d.raw.topProject.label}`)
                    if (d.raw.topAgent) parts.push(`Top agent ${d.raw.topAgent.label}`)
                    parts.push("Press Enter to filter to this day.")
                    return parts.join(". ")
                  })
                  return (
                    <button
                      type="button"
                      class="relative flex-1 min-w-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-text-strong"
                      onMouseEnter={() => setHover(i())}
                      onMouseLeave={() => setHover((h) => (h === i() ? undefined : h))}
                      onFocus={() => setHover(i())}
                      onBlur={() => setHover((h) => (h === i() ? undefined : h))}
                      onClick={() => props.onPickDay(d.day)}
                      aria-pressed={isActive()}
                      aria-label={ariaLabel()}
                    >
                      <Show when={isHover() || isActive()}>
                        <ChartTooltip
                          label={d.label}
                          total={d.total}
                          segments={d.segments}
                          view={props.view()}
                          anchor={i() < data().length / 2 ? "left" : "right"}
                          topModel={d.raw.topModel ?? undefined}
                          topProject={d.raw.topProject ?? undefined}
                          topAgent={d.raw.topAgent ?? undefined}
                        />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        </div>

        {/* X-axis labels: rendered as HTML so they reflow at viewport widths */}
        <div class="ml-[var(--y-axis-w,40px)] mt-2 flex text-10-regular text-text-weak" style={{ gap: `${gap}px` }}>
          <For each={data()}>
            {(d, i) => (
              <div
                class="min-w-0 flex-1 truncate text-center"
                classList={{ "text-text-strong": props.activeDay() === d.day }}
              >
                <Show when={i() % labelEvery() === 0 || i() === data().length - 1}>{shortBucketLabel(d.id)}</Show>
              </div>
            )}
          </For>
        </div>

        <ChartLegend />
      </Show>
    </section>
  )
}

function ChartViewToggle(props: { value: () => View; setValue: (v: View) => void }) {
  const opts: Array<{ key: View; label: string }> = [
    { key: "tokens", label: "Tokens" },
    { key: "cost", label: "API value" },
  ]
  return (
    <For each={opts}>
      {(opt) => (
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
          classList={{
            "bg-surface-raised-base text-text-strong shadow-xs-border-base": props.value() === opt.key,
            "text-text-base hover:text-text-strong": props.value() !== opt.key,
          }}
          onClick={() => props.setValue(opt.key)}
        >
          {opt.label}
        </button>
      )}
    </For>
  )
}

function ChartTooltip(props: {
  label: string
  total: number
  segments: Array<{ key: Bucket; value: number }>
  view: View
  anchor: "left" | "right"
  topModel?: { id: string; label: string; tokens: number }
  topProject?: { id: string; label: string; tokens: number }
  topAgent?: { id: string; label: string; tokens: number }
}) {
  return (
    <div
      class="pointer-events-none absolute bottom-full z-10 mb-2 w-64 rounded-lg border border-border-weaker-base bg-background-stronger p-3 text-12-regular shadow-md-base"
      classList={{
        "left-0": props.anchor === "left",
        "right-0": props.anchor === "right",
      }}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-text-strong">{props.label}</span>
        <span class="text-text-strong">{formatViewValue(props.total, props.view)}</span>
      </div>
      <div class="mt-2 flex flex-col gap-1">
        <For each={props.segments}>
          {(s) => (
            <Show when={s.value > 0}>
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 text-text-base">
                  <span class="size-2 rounded-sm" style={{ "background-color": bucketColor[s.key] }} />
                  {bucketLabel[s.key]}
                </span>
                <span class="tabular-nums text-text-strong">{formatViewValue(s.value, props.view)}</span>
              </div>
            </Show>
          )}
        </For>
      </div>
      <Show when={props.topModel || props.topProject || props.topAgent}>
        <div class="mt-2 border-t border-border-weaker-base pt-2 text-11-regular text-text-weak">
          {/* OCO: NOT keyed — same fresh-wrapper pattern as the Dashboard
              Match reverts above; topModel/topProject/topAgent flow from the
              renderPlan summary that's recomputed every poll tick. */}
          <Show when={props.topModel}>
            {(t) => (
              <div class="flex items-center justify-between gap-2">
                <span>Top model</span>
                <span class="ml-2 truncate text-text-base font-mono">{t().label}</span>
              </div>
            )}
          </Show>
          <Show when={props.topProject}>
            {(t) => (
              <div class="flex items-center justify-between gap-2">
                <span>Top project</span>
                <span class="ml-2 truncate text-text-base">{t().label}</span>
              </div>
            )}
          </Show>
          <Show when={props.topAgent}>
            {(t) => (
              <div class="flex items-center justify-between gap-2">
                <span>Top agent</span>
                <span class="ml-2 truncate text-text-base">{t().label}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ChartLegend() {
  return (
    <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-11-regular text-text-base">
      <For each={buckets}>
        {(b) => (
          <span class="flex items-center gap-1.5">
            <span class="size-2 rounded-sm" style={{ "background-color": bucketColor[b] }} />
            {bucketLabel[b]}
          </span>
        )}
      </For>
    </div>
  )
}

function DistributionPanel(props: {
  title: string
  rows: () => AnalyticsBreakdownRow[]
  activeId: () => string | undefined
  onPick: (id: string) => void
  view: () => View
  /** Cap the number of rows. `undefined` shows every row (used for By project). */
  limit: number | undefined
}) {
  const sorted = createMemo(() => {
    const isCost = props.view() === "cost"
    const list = [...props.rows()].sort(
      (a, b) =>
        (isCost ? b.apiEquivalentCost.amount - a.apiEquivalentCost.amount : b.tokens.total - a.tokens.total) ||
        b.calls - a.calls,
    )
    return props.limit === undefined ? list : list.slice(0, props.limit)
  })
  const totalForPct = createMemo(() => {
    const isCost = props.view() === "cost"
    return props
      .rows()
      .reduce((acc, row) => acc + (isCost ? row.apiEquivalentCost.amount : row.tokens.total), 0)
  })
  const max = createMemo(() => {
    const isCost = props.view() === "cost"
    return Math.max(
      ...sorted().map((row) => (isCost ? row.apiEquivalentCost.amount : row.tokens.total)),
      1,
    )
  })
  return (
    <section class="rounded-[16px] border border-border-weaker-base bg-surface-base p-4 shadow-xs-border-base">
      <div class="flex items-center justify-between gap-2">
        <div class="text-14-medium text-text-strong">{props.title}</div>
        <Show when={props.activeId()}>
          <button
            type="button"
            class="text-11-medium text-text-weak hover:text-text-strong"
            onClick={() => props.onPick(props.activeId()!)}
          >
            Clear
          </button>
        </Show>
      </div>
      <Show
        when={sorted().length > 0}
        fallback={<div class="mt-4 text-12-regular text-text-weak">No usage in this scope.</div>}
      >
        <div class="mt-3 flex flex-col">
          <For each={sorted()}>
            {(row) => {
              const value = () => (props.view() === "cost" ? row.apiEquivalentCost.amount : row.tokens.total)
              const widthPct = () => Math.max(2, (value() / max()) * 100)
              const isActive = () => props.activeId() === row.id
              const sharePct = () => {
                const t = totalForPct()
                if (t <= 0) return 0
                return (value() / t) * 100
              }
              const tooltipBody = () => (
                <DistributionTooltip
                  label={row.label}
                  view={props.view()}
                  sharePct={sharePct()}
                  tokens={row.tokens}
                  cost={row.apiEquivalentCost}
                  calls={row.calls}
                  sessions={row.sessions}
                />
              )
              return (
                <Tooltip value={tooltipBody()} placement="top">
                  <button
                    type="button"
                    class="group relative flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-background-base focus-visible:ring-1 focus-visible:ring-border-strong-base"
                    classList={{ "bg-background-base ring-1 ring-text-strong/30": isActive() }}
                    onClick={() => props.onPick(row.id)}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="min-w-0 truncate text-12-medium text-text-strong">{row.label}</span>
                      <span class="shrink-0 text-12-medium text-text-strong tabular-nums">
                        {props.view() === "cost"
                          ? formatEstimate(row.apiEquivalentCost)
                          : compactFmt.format(row.tokens.total)}
                      </span>
                    </div>
                    <div class="flex h-2 w-full overflow-hidden rounded-full bg-background-base">
                      <BucketSegments tokens={row.tokens} cost={row.apiEquivalentCostBuckets} view={props.view} pct={widthPct} />
                    </div>
                    <div class="flex justify-between text-10-regular text-text-weak tabular-nums">
                      <span>{integerFmt.format(row.calls)} model calls</span>
                      <span>{compactFmt.format(row.tokens.total)} tokens</span>
                    </div>
                  </button>
                </Tooltip>
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}

function DistributionTooltip(props: {
  label: string
  view: View
  sharePct: number
  tokens: AnalyticsTokenTotals
  cost: AnalyticsEstimatedCost
  calls: number
  sessions: number
}) {
  return (
    <div class="flex w-56 flex-col gap-1 text-11-regular">
      <div class="text-text-strong text-12-medium">{props.label}</div>
      <div class="flex items-center justify-between gap-2 text-text-base">
        <span>Share of {props.view === "cost" ? "API value" : "tokens"}</span>
        <span class="tabular-nums text-text-strong">{props.sharePct.toFixed(1)}%</span>
      </div>
      <div class="flex items-center justify-between gap-2 text-text-base">
        <span>API-equivalent</span>
        <span class="tabular-nums text-text-strong">{formatEstimate(props.cost)}</span>
      </div>
      <div class="flex items-center justify-between gap-2 text-text-base">
        <span>Tokens</span>
        <span class="tabular-nums text-text-strong">{integerFmt.format(props.tokens.total)}</span>
      </div>
      <div class="flex items-center justify-between gap-2 text-text-base">
        <span>Model calls · sessions</span>
        <span class="tabular-nums text-text-strong">
          {integerFmt.format(props.calls)} · {integerFmt.format(props.sessions)}
        </span>
      </div>
    </div>
  )
}

function BucketSegments(props: {
  tokens: AnalyticsTokenTotals
  cost: AnalyticsCostBuckets
  view: () => View
  pct: () => number
}) {
  const isCost = () => props.view() === "cost"
  const segments = createMemo(() => {
    const total = isCost()
      ? buckets.reduce((acc, b) => acc + (props.cost[b]?.amount ?? 0), 0)
      : props.tokens.total
    if (total <= 0) return []
    return buckets
      .map((b) => ({
        key: b,
        value: isCost() ? props.cost[b]?.amount ?? 0 : props.tokens[b],
      }))
      .map((s) => ({ ...s, pct: (s.value / total) * 100 }))
  })
  return (
    <div class="flex h-full" style={{ width: `${props.pct()}%` }}>
      <For each={segments()}>
        {(s) => (
          <Show when={s.value > 0}>
            <div class="h-full" style={{ width: `${s.pct}%`, "background-color": bucketColor[s.key] }} />
          </Show>
        )}
      </For>
    </div>
  )
}

function PricingCoveragePanel(props: { coverage: () => AnalyticsSummary["coverage"] }) {
  return (
    <Show when={props.coverage().hasGaps}>
      <section class="rounded-[16px] border border-border-warning-weaker bg-[linear-gradient(135deg,rgba(245,159,0,0.10),rgba(255,255,255,0)_46%)] p-4 shadow-xs-border-base">
        <div class="flex items-start gap-3">
          <Icon name="warning" size="medium" class="mt-0.5 text-icon-warning-base" />
          <div class="flex flex-1 flex-col gap-1">
            <div class="text-14-medium text-text-strong">Pricing coverage gap</div>
            <div class="text-12-regular text-text-base">
              Some models in view have no or partial standard pricing. API-equivalent value for these is incomplete
              until you add an alias or direct pricing entry. Click a model id to copy it.
            </div>
          </div>
        </div>
        {/* Show every gap in view, sorted by usage impact. The spec requires every offending
            model identifier to be listed so the user can name them all to the agent. */}
        <div class="mt-3 flex flex-col gap-1">
          <For each={props.coverage().gaps}>{(gap) => <PricingGapRow gap={gap} />}</For>
        </div>
      </section>
    </Show>
  )
}

function PricingGapRow(props: { gap: AnalyticsPricingGap }) {
  const id = () => `${props.gap.provider}/${props.gap.model}`
  return (
    <button
      type="button"
      class="group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-background-base"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id())
          showToast({ title: "Copied", description: `${id()} copied to clipboard` })
        } catch {
          showToast({ title: "Could not copy", description: id() })
        }
      }}
      title={
        props.gap.kind === "unpriced"
          ? `Unpriced model — ${currency.format(props.gap.missingApiEquivalent)} of recorded provider cost is not reflected in the API-equivalent total.`
          : `Partial pricing — ${currency.format(props.gap.missingApiEquivalent)} of recorded provider cost is not covered by known token rates.`
      }
    >
      <span class="flex items-center gap-2 text-12-medium text-text-strong">
        <Icon name="copy" size="small" class="text-text-weak group-hover:text-text-strong" />
        <span class="font-mono">{id()}</span>
        <span
          class="rounded-full px-1.5 py-0.5 text-10-medium uppercase tracking-wide"
          classList={{
            "bg-icon-warning-base/15 text-icon-warning-base": props.gap.kind === "unpriced",
            "bg-text-weak/15 text-text-weak": props.gap.kind === "partial",
          }}
        >
          {props.gap.kind}
        </span>
      </span>
      <span class="flex items-center gap-3 text-11-regular text-text-weak tabular-nums">
        <span>{integerFmt.format(props.gap.calls)} calls</span>
        <span>{compactFmt.format(props.gap.tokens)} tokens</span>
        <Show when={props.gap.missingApiEquivalent > 0}>
          <span class="text-icon-warning-base">~{currency.format(props.gap.missingApiEquivalent)} missing</span>
        </Show>
      </span>
    </button>
  )
}

function HighImpactPanel(props: {
  sessions: () => AnalyticsSessionRow[]
  responses: () => AnalyticsResponseRow[]
  openSession: (row: AnalyticsSessionRow | AnalyticsResponseRow) => void
}) {
  const [tab, setTab] = createSignal<"sessions" | "responses">("sessions")
  const [open, setOpen] = createSignal(false)
  const peekCount = 3
  return (
    <section class="rounded-[16px] border border-border-weaker-base bg-surface-base p-4 shadow-xs-border-base">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1 rounded-lg bg-background-base p-0.5">
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
            classList={{
              "bg-surface-raised-base text-text-strong shadow-xs-border-base": tab() === "sessions",
              "text-text-base hover:text-text-strong": tab() !== "sessions",
            }}
            onClick={() => setTab("sessions")}
          >
            Top sessions
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-12-medium transition-colors"
            classList={{
              "bg-surface-raised-base text-text-strong shadow-xs-border-base": tab() === "responses",
              "text-text-base hover:text-text-strong": tab() !== "responses",
            }}
            onClick={() => setTab("responses")}
          >
            Top responses
          </button>
        </div>
        <button
          type="button"
          class="text-12-medium text-text-base hover:text-text-strong"
          onClick={() => setOpen((v) => !v)}
        >
          {open() ? "Show fewer" : "Show all"}
        </button>
      </div>
      <Switch>
        <Match when={tab() === "sessions"}>
          <div class="mt-3 flex flex-col">
            <For each={(open() ? props.sessions() : props.sessions().slice(0, peekCount))}>
              {(row) => <SessionRow row={row} onOpen={() => props.openSession(row)} />}
            </For>
          </div>
        </Match>
        <Match when={tab() === "responses"}>
          <div class="mt-3 flex flex-col">
            <For each={(open() ? props.responses() : props.responses().slice(0, peekCount))}>
              {(row) => <ResponseRow row={row} onOpen={() => props.openSession(row)} />}
            </For>
          </div>
        </Match>
      </Switch>
    </section>
  )
}

function SessionRow(props: { row: AnalyticsSessionRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background-base"
      onClick={props.onOpen}
    >
      <div class="flex min-w-0 flex-col">
        <span class="truncate text-12-medium text-text-strong">{props.row.title}</span>
        <span class="truncate text-11-regular text-text-weak">{props.row.project}</span>
      </div>
      <div class="flex shrink-0 items-center gap-3 text-11-regular text-text-weak tabular-nums">
        <span>{integerFmt.format(props.row.calls)} calls</span>
        <span>{compactFmt.format(props.row.tokens.total)} tokens</span>
        <span class="text-text-strong">{formatEstimate(props.row.apiEquivalentCost)}</span>
      </div>
    </button>
  )
}

function ResponseRow(props: { row: AnalyticsResponseRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background-base"
      onClick={props.onOpen}
    >
      <div class="flex min-w-0 flex-col">
        <span class="truncate text-12-medium text-text-strong font-mono">
          {props.row.provider}/{props.row.model}
        </span>
        <span class="truncate text-11-regular text-text-weak">
          {props.row.agent} in {props.row.project}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-3 text-11-regular text-text-weak tabular-nums">
        <span>{integerFmt.format(props.row.calls)} calls</span>
        <span>{compactFmt.format(props.row.tokens.total)} tokens</span>
        <span class="text-text-strong">{formatEstimate(props.row.apiEquivalentCost)}</span>
      </div>
    </button>
  )
}

function formatEstimate(value: AnalyticsEstimatedCost) {
  if (value.knownResponses === 0 && value.unknownResponses > 0) return "Unavailable"
  const suffix = value.unknownResponses > 0 ? " partial" : ""
  return `${currency.format(value.amount)}${suffix}`
}

function formatViewValue(value: number, view: View) {
  if (view === "cost") return currency.format(value)
  return compactFmt.format(value)
}

function shortBucketLabel(id: string) {
  const [date, hour] = id.split(" ")
  const [, m, d] = date?.split("-") ?? []
  if (!m || !d) return id
  if (hour) return `${m}/${d} ${hour.slice(0, 2)}`
  return `${m}/${d}`
}
