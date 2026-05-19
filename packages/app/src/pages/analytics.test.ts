import { describe, expect, test } from "bun:test"
import type { AnalyticsSummary } from "@opencode-ai/sdk/v2/client"
import {
  analyticsDisplayedSummary,
  analyticsIsProgressSummary,
  analyticsRenderPlan,
  type AnalyticsRenderPlanInput,
} from "./analytics-helpers"

describe("analytics period-switch refresh behavior", () => {
  test("keeps the latest populated dashboard visible while a new resource fetch is in flight", () => {
    const latest = { generatedAt: 1 } as any

    expect(analyticsDisplayedSummary(undefined, latest)).toBe(latest)
  })

  test("uses fresh data once the refetch completes", () => {
    const latest = { generatedAt: 1 } as any
    const current = { generatedAt: 2 } as any

    expect(analyticsDisplayedSummary(current, latest)).toBe(current)
  })

  test("keeps a populated dashboard visible when a catch-up response arrives", () => {
    const latest = { generatedAt: 1, totals: { calls: 10 } } as any
    const current = { generatedAt: 2, totals: { calls: 0 }, backfilling: { total: 12, processed: 10 } } as any

    expect(analyticsDisplayedSummary(current, latest)).toBe(latest)
  })

  test("allows explicit rebuild progress to replace the prior dashboard when caller asks for it", () => {
    const latest = { generatedAt: 1, totals: { calls: 10 } } as any
    const current = { generatedAt: 2, totals: { calls: 0 }, backfilling: { total: 12, processed: 0 } } as any

    expect(analyticsDisplayedSummary(current, latest, { preferProgress: true })).toBe(current)
  })

  test("identifies progress summaries for non-blocking status copy", () => {
    expect(analyticsIsProgressSummary({ backfilling: { total: 2, processed: 1 } } as any)).toBe(true)
    expect(analyticsIsProgressSummary({ generatedAt: 1 } as any)).toBe(false)
  })

  test("keeps dashboard motion restrained and disabled for reduced-motion users", async () => {
    const source = await Bun.file(new URL("./analytics.tsx", import.meta.url)).text()

    expect(source).toContain("oco-analytics-chart-bars rect")
    expect(source).toContain("transition: y 180ms ease, height 180ms ease, opacity 180ms ease")
    expect(source).toContain("@media (prefers-reduced-motion: reduce)")
    expect(source).toContain("transition: none !important")
  })

  test("source no longer flashes a generic refresh strip on every polling cycle", async () => {
    const source = await Bun.file(new URL("./analytics.tsx", import.meta.url)).text()

    // We deliberately removed the per-fetch refresh strip so polling does not blink.
    expect(source).not.toMatch(/RefreshProgressStrip/)
    expect(source).not.toMatch(/Refreshing local history/)
    // The catch-up strip is the single steady status line and is not gated on summary.loading.
    expect(source).toContain("CatchupProgressStrip")
    expect(source).toContain("showCatchupStrip")
    // Header refresh / rebuild buttons disable on user-initiated actions only.
    expect(source).toContain("busy={() => manualRefreshing() || explicitRebuild()}")
  })

  test("render plan dispatch wires the dashboard branch through a Match accessor", async () => {
    const source = await Bun.file(new URL("./analytics.tsx", import.meta.url)).text()

    // Each render plan kind dispatches through a pre-built accessor so the JSX child
    // callback receives a typed variant rather than a manual cast — and the dashboard /
    // KPIs / chart mount under a single Match branch that stays stable while the plan
    // continues to report kind "dashboard".
    expect(source).toContain("const mainDashboard = mainOfKind(renderPlan, \"dashboard\")")
    expect(source).toContain("const mainFullProgress = mainOfKind(renderPlan, \"fullProgress\")")
    expect(source).toContain("<Match when={mainDashboard()}>")
    expect(source).toContain("<Match when={mainFullProgress()}>")
    // Dashboard sections expose stable test hooks so future rendered checks can locate
    // them without depending on string content that changes between locales.
    expect(source).toContain("data-analytics-dashboard")
    expect(source).toContain("data-analytics-kpi-strip")
    expect(source).toContain("data-analytics-chart")
    expect(source).toContain("data-analytics-catchup-strip")
    expect(source).toContain("data-analytics-full-progress")
  })

  test("dashboard dim attribute only reflects manual refresh, not summary.loading", async () => {
    const source = await Bun.file(new URL("./analytics.tsx", import.meta.url)).text()

    // The `data-refreshing` attribute used to be driven by `summary.loading`, which
    // flipped to true on every polling cycle and caused the visible fade. The dim is
    // now wired to the render plan's `dim` field, which only goes true when the user
    // explicitly clicked refresh.
    expect(source).toContain("refreshing={() => plan().dim}")
    expect(source).not.toMatch(/refreshing=\(\)\s*=>\s*summary\.loading/)
    expect(source).not.toMatch(/data-refreshing=\{\s*summary\.loading/)
  })

  test("explicit rebuild keeps a trustworthy dashboard mounted via latestTrustworthy", async () => {
    const source = await Bun.file(new URL("./analytics.tsx", import.meta.url)).text()

    // `latestTrustworthy` is the non-progress fallback that the helper reads as `latest`.
    // We deliberately drop `preferProgress` from the rendering selection so explicit
    // rebuild does not replace usable data with a full-screen progress panel.
    expect(source).toContain("setLatestTrustworthy(current)")
    expect(source).toContain("latestTrustworthy: latestTrustworthy()")
    expect(source).toContain("latestRaw: summary.latest")
    expect(source).not.toMatch(/preferProgress:\s*explicitRebuild\(\)/)
  })

  test("if packages/app/dist/ exists, the built Analytics chunk reflects the no-flicker contract", async () => {
    // Verifies the freshness of the local frontend bundle for CLI/TUI standalone installs.
    // We only run this when `packages/app/dist/` has been built; otherwise we no-op so a
    // bare workspace clone does not fail this test. When the bundle is present, it must
    // carry the current Analytics markers and must NOT carry the removed legacy strip.
    const distDir = new URL("../../dist/assets/", import.meta.url)
    const glob = new Bun.Glob("analytics-*.js")
    const matches: string[] = []
    try {
      for await (const f of glob.scan({ cwd: distDir.pathname })) matches.push(f)
    } catch {
      return
    }
    if (matches.length === 0) return

    const bundle = await Bun.file(new URL(matches[0]!, distDir)).text()

    // Current labels and markers that must be present.
    expect(bundle).toContain("Model calls")
    expect(bundle).toContain("Catching up local history")
    expect(bundle).toContain("Dashboard stays live")
    expect(bundle).toContain("Rebuild in progress")
    expect(bundle).toContain("data-analytics-dashboard")

    // Legacy behaviors that must be absent.
    expect(bundle).not.toContain("Refreshing local history")
    expect(bundle).not.toMatch(/RefreshProgressStrip/)
  })
})

// --- analyticsRenderPlan ----------------------------------------------------

function progress(opts: { calls?: number; total?: number; processed?: number; generatedAt?: number; kind?: "backfilling" | "recalculating" }) {
  const calls = opts.calls ?? 0
  const total = opts.total ?? 100
  const processed = opts.processed ?? 0
  const base: any = {
    generatedAt: opts.generatedAt ?? 1,
    totals: { calls, sessions: 0, tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    availableProjects: [],
  }
  if (opts.kind === "recalculating") base.recalculating = { total, processed }
  else base.backfilling = { total, processed }
  return base as AnalyticsSummary
}

function ready(opts: { calls?: number; generatedAt?: number } = {}) {
  const calls = opts.calls ?? 10
  return {
    generatedAt: opts.generatedAt ?? 2,
    totals: { calls, sessions: 1, tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    availableProjects: [],
  } as any as AnalyticsSummary
}

function input(partial: Partial<AnalyticsRenderPlanInput> = {}): AnalyticsRenderPlanInput {
  return {
    current: undefined,
    latestTrustworthy: undefined,
    latestRaw: undefined,
    hasError: false,
    loading: false,
    manualRefreshInFlight: false,
    explicitRebuild: false,
    filtersAreNarrowed: false,
    ...partial,
  }
}

describe("analyticsRenderPlan — non-flicker contract", () => {
  test("first load with no data anywhere shows the LoadingPanel and no catch-up strip", () => {
    const plan = analyticsRenderPlan(input({ loading: true }))

    expect(plan.main.kind).toBe("loading")
    expect(plan.showCatchupStrip).toBe(false)
    expect(plan.catchupRebuildLabel).toBe(false)
  })

  test("ready dashboard renders without the catch-up strip", () => {
    const data = ready({ calls: 12 })
    const plan = analyticsRenderPlan(input({ current: data, latestRaw: data, latestTrustworthy: data }))

    expect(plan.main.kind).toBe("dashboard")
    if (plan.main.kind === "dashboard") {
      expect(plan.main.summary).toBe(data)
      expect(plan.main.dim).toBe(false)
    }
    expect(plan.showCatchupStrip).toBe(false)
  })

  test("ordinary catch-up keeps the dashboard mounted and shows a steady catch-up strip", () => {
    const previous = ready({ calls: 10 })
    const progressing = progress({ calls: 0, total: 200, processed: 40 })
    const plan = analyticsRenderPlan(
      input({
        current: progressing,
        latestRaw: progressing,
        latestTrustworthy: previous,
      }),
    )

    expect(plan.main.kind).toBe("dashboard")
    if (plan.main.kind === "dashboard") {
      expect(plan.main.summary).toBe(previous)
      expect(plan.main.dim).toBe(false)
    }
    expect(plan.showCatchupStrip).toBe(true)
    expect(plan.catchupRebuildLabel).toBe(false)
  })

  test("repeated automatic progress responses do not flip the dashboard to a progress panel", () => {
    const previous = ready({ calls: 10 })
    // Three consecutive polling responses, each a progress payload with calls=0. We never
    // want the dashboard to remount or fade because the same data is on screen across them.
    const cycle = [
      progress({ calls: 0, total: 200, processed: 10 }),
      progress({ calls: 0, total: 200, processed: 30 }),
      progress({ calls: 0, total: 200, processed: 60 }),
    ]
    const plans = cycle.map((current) =>
      analyticsRenderPlan(
        input({ current, latestRaw: current, latestTrustworthy: previous }),
      ),
    )

    for (const plan of plans) {
      expect(plan.main.kind).toBe("dashboard")
      if (plan.main.kind === "dashboard") {
        expect(plan.main.summary).toBe(previous)
        expect(plan.main.dim).toBe(false)
      }
      expect(plan.showCatchupStrip).toBe(true)
    }
  })

  test("progress response with cached rows surfaces a dashboard, not a blocking progress panel", () => {
    const progressWithCache = progress({ calls: 7, total: 200, processed: 50 })
    const plan = analyticsRenderPlan(
      input({ current: progressWithCache, latestRaw: progressWithCache }),
    )

    expect(plan.main.kind).toBe("dashboard")
    if (plan.main.kind === "dashboard") {
      expect(plan.main.summary).toBe(progressWithCache)
      expect(plan.main.dim).toBe(false)
    }
    expect(plan.showCatchupStrip).toBe(true)
  })

  test("explicit rebuild with prior trustworthy data keeps the dashboard and labels the strip", () => {
    const previous = ready({ calls: 10 })
    const rebuildResponse = progress({ calls: 0, total: 300, processed: 0 })
    const plan = analyticsRenderPlan(
      input({
        current: rebuildResponse,
        latestRaw: rebuildResponse,
        latestTrustworthy: previous,
        explicitRebuild: true,
      }),
    )

    expect(plan.main.kind).toBe("dashboard")
    if (plan.main.kind === "dashboard") {
      expect(plan.main.summary).toBe(previous)
      expect(plan.main.dim).toBe(false)
    }
    expect(plan.showCatchupStrip).toBe(true)
    expect(plan.catchupRebuildLabel).toBe(true)
  })

  test("explicit rebuild without prior data falls back to a full progress panel", () => {
    const rebuildResponse = progress({ calls: 0, total: 300, processed: 50 })
    const plan = analyticsRenderPlan(
      input({
        current: rebuildResponse,
        latestRaw: rebuildResponse,
        explicitRebuild: true,
      }),
    )

    expect(plan.main.kind).toBe("fullProgress")
    if (plan.main.kind === "fullProgress") {
      expect(plan.main.rebuilding).toBe(true)
      expect(plan.main.processed).toBe(50)
      expect(plan.main.total).toBe(300)
    }
    expect(plan.showCatchupStrip).toBe(false)
  })

  test("background polling never dims the dashboard — only manual refresh does", () => {
    const previous = ready({ calls: 10 })
    const progressing = progress({ calls: 0, total: 200, processed: 40 })

    const polling = analyticsRenderPlan(
      input({
        current: progressing,
        latestRaw: progressing,
        latestTrustworthy: previous,
        loading: true,
        manualRefreshInFlight: false,
      }),
    )
    expect(polling.main.kind).toBe("dashboard")
    if (polling.main.kind === "dashboard") expect(polling.main.dim).toBe(false)

    const manual = analyticsRenderPlan(
      input({
        current: previous,
        latestRaw: previous,
        latestTrustworthy: previous,
        loading: true,
        manualRefreshInFlight: true,
      }),
    )
    expect(manual.main.kind).toBe("dashboard")
    if (manual.main.kind === "dashboard") expect(manual.main.dim).toBe(true)
  })

  test("filter change with cached trustworthy data avoids flashing to a loading panel", () => {
    const cached = ready({ calls: 10 })
    const plan = analyticsRenderPlan(
      input({
        current: undefined,
        loading: true,
        latestRaw: cached,
        latestTrustworthy: cached,
      }),
    )

    expect(plan.main.kind).toBe("dashboard")
  })

  test("zero-usage non-progress summary renders the empty panel without a status strip", () => {
    const empty = ready({ calls: 0 })
    const plan = analyticsRenderPlan(
      input({ current: empty, latestRaw: empty, latestTrustworthy: empty, filtersAreNarrowed: true }),
    )

    expect(plan.main.kind).toBe("empty")
    if (plan.main.kind === "empty") expect(plan.main.canReset).toBe(true)
    expect(plan.showCatchupStrip).toBe(false)
  })

  test("error during refetch keeps a stale dashboard visible behind a non-destructive banner", () => {
    const cached = ready({ calls: 10 })
    const plan = analyticsRenderPlan(
      input({ hasError: true, latestTrustworthy: cached, latestRaw: cached }),
    )

    expect(plan.main.kind).toBe("errorWithStale")
    if (plan.main.kind === "errorWithStale") expect(plan.main.summary).toBe(cached)
  })

  test("first-load error with no prior data renders the full error panel", () => {
    const plan = analyticsRenderPlan(input({ hasError: true }))

    expect(plan.main.kind).toBe("errorOnly")
  })
})
