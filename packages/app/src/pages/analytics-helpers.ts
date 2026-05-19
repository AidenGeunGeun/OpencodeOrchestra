import type { AnalyticsSummary } from "@opencode-ai/sdk/v2/client"

export function analyticsIsProgressSummary(summary: AnalyticsSummary | undefined) {
  return !!summary?.backfilling || !!summary?.recalculating
}

export function analyticsDisplayedSummary(
  current: AnalyticsSummary | undefined,
  latest: AnalyticsSummary | undefined,
  opts: { preferProgress?: boolean } = {},
) {
  if (!opts.preferProgress && analyticsIsProgressSummary(current) && latest && !analyticsIsProgressSummary(latest)) {
    return latest
  }
  return current ?? latest
}

/**
 * Render decision for the Analytics page given the current resource state.
 *
 * The goal is to keep useful data visually stable during background catch-up.
 * Concretely:
 * - The dashboard stays mounted whenever a usable summary exists.
 * - A single quiet catch-up status line replaces per-poll "refresh strips" so
 *   we do not flash a loading indicator on every poll.
 * - The dashboard only fades when the user actively clicked refresh, never
 *   on automatic background polling.
 * - Explicit rebuild keeps the dashboard mounted whenever any non-progress
 *   data is available; it only falls back to the full progress panel when
 *   nothing usable exists.
 */
export type AnalyticsRenderPlan = {
  /** The summary that the dashboard will render, or undefined when no panel can use it. */
  displayed: AnalyticsSummary | undefined
  /** Discriminated body the page should mount under the header. */
  main:
    | { kind: "loading" }
    | { kind: "errorOnly" }
    | { kind: "errorWithStale"; summary: AnalyticsSummary }
    | { kind: "empty"; canReset: boolean }
    | { kind: "fullProgress"; total: number; processed: number; recalculating: boolean; rebuilding: boolean }
    | { kind: "dashboard"; summary: AnalyticsSummary; dim: boolean }
  /** Steady status strip while a non-blocking catch-up or rebuild is happening. */
  showCatchupStrip: boolean
  /** True when the catch-up strip should display the rebuild label instead of the catch-up label. */
  catchupRebuildLabel: boolean
}

export type AnalyticsRenderPlanInput = {
  /** The actively-tracked summary value. May be undefined while a fetch is in flight. */
  current: AnalyticsSummary | undefined
  /**
   * The most recent trustworthy (non-progress) summary, preserved across catch-up and
   * rebuild cycles. The dashboard falls back to this when `current` is a progress-marked
   * response so usable data stays visible while the server catches up.
   */
  latestTrustworthy: AnalyticsSummary | undefined
  /**
   * The most recent resolved summary regardless of progress state. Used to decide whether
   * the server is currently in catch-up; this stays accurate even after a rebuild response
   * overwrites `summary.latest` in Solid's resource tracker.
   */
  latestRaw: AnalyticsSummary | undefined
  hasError: boolean
  /** True while a fetch is in flight (any cause). Used only to size the first-load state, never to dim the dashboard. */
  loading: boolean
  /** True only while the user explicitly clicked the refresh control and the response has not settled yet. */
  manualRefreshInFlight: boolean
  /** True while the user has triggered an explicit rebuild and the response is still progress-marked. */
  explicitRebuild: boolean
  /** True when the active dashboard is restricted by any filter, period, or project chip. */
  filtersAreNarrowed: boolean
}

export function analyticsRenderPlan(input: AnalyticsRenderPlanInput): AnalyticsRenderPlan {
  const {
    current,
    latestTrustworthy,
    latestRaw,
    hasError,
    loading,
    manualRefreshInFlight,
    explicitRebuild,
    filtersAreNarrowed,
  } = input

  // Pick the summary the dashboard would render. We never let an incoming progress
  // response unseat a trustworthy prior dashboard during ordinary catch-up. Explicit
  // rebuild follows the same rule when previous data exists so the user sees their
  // dashboard plus a rebuild status line, instead of a full progress panel.
  const displayed = analyticsDisplayedSummary(current, latestTrustworthy ?? latestRaw)

  const anyLatest = latestTrustworthy ?? latestRaw

  // First-load loading state — no data anywhere yet.
  if (loading && !anyLatest && !current) {
    return baseplan({ displayed: undefined, main: { kind: "loading" } })
  }

  // Error state — fall back to a stale dashboard if we have one, otherwise show an error panel.
  if (hasError && !anyLatest) {
    return baseplan({ displayed: undefined, main: { kind: "errorOnly" } })
  }
  if (hasError && anyLatest) {
    return baseplan({ displayed: anyLatest, main: { kind: "errorWithStale", summary: anyLatest } })
  }

  // Catch-up status is true whenever the latest known server response is progress-marked
  // AND the dashboard underneath has at least some usable data to show. We use
  // `current ?? latestRaw` rather than `latestTrustworthy` so the strip stays visible
  // through rebuild cycles where Solid's tracker briefly only knows about progress
  // payloads. The "live" progress reading is what tells us the server is still catching
  // up, even if we have older trustworthy data on screen.
  const serverProgress = current ?? latestRaw
  const currentIsProgress = analyticsIsProgressSummary(serverProgress)
  const dashboardHasUsage = !!displayed && (displayed.totals.calls ?? 0) > 0
  const showCatchupStrip = currentIsProgress && dashboardHasUsage
  const catchupRebuildLabel = showCatchupStrip && explicitRebuild

  if (displayed) {
    const isProgressOnly = analyticsIsProgressSummary(displayed) && (displayed.totals.calls ?? 0) === 0
    if (isProgressOnly) {
      const progress = (displayed.backfilling ?? displayed.recalculating)!
      return {
        displayed,
        main: {
          kind: "fullProgress",
          total: progress.total,
          processed: progress.processed,
          recalculating: !!displayed.recalculating,
          rebuilding: explicitRebuild,
        },
        showCatchupStrip: false,
        catchupRebuildLabel: false,
      }
    }

    const hasUsage = (displayed.totals.calls ?? 0) > 0
    if (!hasUsage) {
      return {
        displayed,
        main: { kind: "empty", canReset: filtersAreNarrowed },
        showCatchupStrip,
        catchupRebuildLabel,
      }
    }

    return {
      displayed,
      main: { kind: "dashboard", summary: displayed, dim: !!manualRefreshInFlight && !!anyLatest },
      showCatchupStrip,
      catchupRebuildLabel,
    }
  }

  // Fallback: no displayable summary — show loading. This covers a fresh open whose first
  // fetch has not resolved yet.
  return baseplan({ displayed: undefined, main: { kind: "loading" } })
}

function baseplan(
  base: Pick<AnalyticsRenderPlan, "displayed" | "main">,
): AnalyticsRenderPlan {
  return {
    ...base,
    showCatchupStrip: false,
    catchupRebuildLabel: false,
  }
}
