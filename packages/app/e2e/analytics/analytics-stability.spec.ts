// OCO-only file: rendered Analytics no-flicker contract. See oco-dev skill deltas-catalog.md.

import type { Page, Route } from "@playwright/test"
import { test, expect } from "../fixtures"

type AnalyticsResponse = {
  totals: { calls: number }
  backfilling?: { total: number; processed: number }
  recalculating?: { total: number; processed: number }
}

function readySummary(opts: { calls?: number; generatedAt?: number } = {}) {
  const calls = opts.calls ?? 14
  return {
    period: "30d",
    project: undefined,
    generatedAt: opts.generatedAt ?? Date.now(),
    range: { start: 0, end: Date.now() },
    totals: {
      actualCost: 0,
      apiEquivalentCost: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
      calls,
      sessions: 2,
      tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      apiEquivalentCostBuckets: {
        freshInput: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        output: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        reasoning: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        cacheRead: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        cacheWrite: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        total: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
      },
      cacheHitRate: 0,
    },
    breakdowns: { byBucket: [], byProject: [], byModel: [], byAgent: [] },
    highImpact: { sessions: [], responses: [] },
    coverage: { hasGaps: false, gaps: [] },
    availableProjects: [],
  }
}

function progressSummary(opts: { calls?: number; total?: number; processed?: number } = {}) {
  const summary = readySummary({ calls: opts.calls ?? 0 })
  ;(summary as any).backfilling = { total: opts.total ?? 200, processed: opts.processed ?? 25 }
  return summary
}

type AnalyticsResponseFn = () => AnalyticsResponse

async function installAnalyticsMock(page: Page, nextResponse: AnalyticsResponseFn) {
  await page.route("**/global/analytics?**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextResponse()),
    })
  })
  await page.route("**/global/analytics/rebuild", async (route: Route) => {
    await route.fulfill({ status: 200, headers: { "Content-Type": "application/json" }, body: "{}" })
  })
}

async function gotoAnalytics(page: Page) {
  await page.goto("/analytics")
  await expect(page.locator("[data-analytics-dashboard], [data-analytics-full-progress]")).toBeVisible()
}

test.describe("Analytics page rendered stability", () => {
  test("ready dashboard survives repeated automatic catch-up responses and a final ready response", async ({ page }) => {
    // The spec's required sequence is: ready dashboard → repeated automatic progress
    // responses → final ready response. The page only enters its 1-second polling loop
    // after it has received a progress-marked summary, so we open with ready data, click
    // the refresh control to force a refetch, switch the mock to progress for the next
    // few seconds of polling, then switch back to ready to settle the loop.
    let mode: "ready" | "progress" = "ready"
    let cycle = 0
    await installAnalyticsMock(page, () => {
      if (mode === "ready") return readySummary({ calls: 24 })
      cycle += 1
      return progressSummary({ calls: 0, total: 240, processed: 30 * cycle })
    })

    await gotoAnalytics(page)

    const dashboard = page.locator("[data-analytics-dashboard]")
    const kpiStrip = page.locator("[data-analytics-kpi-strip]")
    const chart = page.locator("[data-analytics-chart]")
    const catchupStrip = page.locator("[data-analytics-catchup-strip]")
    const fullProgress = page.locator("[data-analytics-full-progress]")

    // 1) Ready dashboard. No catch-up strip, no full-progress panel.
    await expect(dashboard).toBeVisible()
    await expect(kpiStrip).toBeVisible()
    await expect(chart).toBeVisible()
    await expect(catchupStrip).toHaveCount(0)
    await expect(fullProgress).toHaveCount(0)

    // Capture the dashboard handle so we can prove the same element instance survives
    // every progress polling cycle (Solid keeps the Match branch mounted whenever the
    // plan stays on the "dashboard" kind).
    const dashboardElement = await dashboard.elementHandle()

    // 2) Flip the mock to progress responses and force a refetch via the refresh control.
    //    This is the moment the user would discover the server is catching up — the live
    //    dashboard must not flip to a blocking progress panel.
    mode = "progress"
    await page.getByRole("button", { name: /Refresh analytics/i }).click()

    await expect(catchupStrip).toBeVisible({ timeout: 5_000 })
    await expect(catchupStrip).toContainText(/Catching up local history/)
    await expect(catchupStrip).toContainText(/Dashboard stays live/)

    const catchupElement = await catchupStrip.elementHandle()

    // Reset the polling counter — the initial click-refresh response counted as one. We
    // want to prove the dashboard survives at least three subsequent automatic polling
    // responses, matching the spec's "repeated automatic progress responses" language.
    const startCycles = cycle
    const startedAt = Date.now()
    while (Date.now() - startedAt < 3_500) {
      await expect(fullProgress).toHaveCount(0)
      await expect(dashboard).toBeVisible()
      await expect(kpiStrip).toBeVisible()
      await expect(chart).toBeVisible()
      await expect(catchupStrip).toBeVisible()
      const sameDashboard = await page.evaluate(
        ([before, now]) => before === now,
        [dashboardElement, await dashboard.elementHandle()],
      )
      const sameStrip = await page.evaluate(
        ([before, now]) => before === now,
        [catchupElement, await catchupStrip.elementHandle()],
      )
      expect(sameDashboard).toBeTruthy()
      expect(sameStrip).toBeTruthy()
      await page.waitForTimeout(800)
    }
    // Confirm the mock actually served at least three subsequent progress responses
    // (≥4 total including the refresh click) before we move on.
    expect(cycle - startCycles).toBeGreaterThanOrEqual(3)
    await dashboardElement?.dispose()
    await catchupElement?.dispose()

    // 4) Final ready response settles the catch-up loop. The catch-up strip clears and
    //    the dashboard / KPI strip / chart remain visible.
    mode = "ready"
    await expect(catchupStrip).toHaveCount(0, { timeout: 5_000 })
    await expect(dashboard).toBeVisible()
    await expect(kpiStrip).toBeVisible()
    await expect(chart).toBeVisible()
    await expect(fullProgress).toHaveCount(0)
  })

  test("dashboard data-refreshing attribute does not flip during automatic polling", async ({ page }) => {
    // Drive the page into its polling loop and prove the dim attribute stays false the
    // whole time. Polling is not a user-initiated action so it must never dim the UI.
    let cycle = 0
    await installAnalyticsMock(page, () => {
      cycle += 1
      return progressSummary({ calls: 10, total: 240, processed: 20 * cycle })
    })

    await gotoAnalytics(page)

    const dashboard = page.locator("[data-analytics-dashboard]")
    await expect(dashboard).toBeVisible()
    await expect(dashboard).toHaveAttribute("data-refreshing", "false")

    const samples: Array<string | null> = []
    for (let i = 0; i < 5; i += 1) {
      samples.push(await dashboard.getAttribute("data-refreshing"))
      await page.waitForTimeout(500)
    }
    expect(samples.every((value) => value === "false")).toBeTruthy()
  })

  test("explicit rebuild keeps trustworthy data visible with a rebuild status label", async ({ page }) => {
    // Open with ready data first, then click the rebuild control to trigger explicit
    // rebuild. The mock immediately switches to progress-with-cache to model the server
    // having cleared its tables and started backfilling. The dashboard from the prior
    // trustworthy summary must stay mounted and the catch-up strip must say "Rebuild in
    // progress" — not a blocking full-progress panel.
    const ready = readySummary({ calls: 14 })
    let serverState: "ready" | "progress" = "ready"
    let cycle = 0
    await installAnalyticsMock(page, () => {
      if (serverState === "ready") return ready
      cycle += 1
      return progressSummary({ calls: 14, total: 200, processed: 25 * cycle })
    })

    await gotoAnalytics(page)

    const dashboard = page.locator("[data-analytics-dashboard]")
    const catchupStrip = page.locator("[data-analytics-catchup-strip]")
    const fullProgress = page.locator("[data-analytics-full-progress]")

    await expect(dashboard).toBeVisible()
    await expect(catchupStrip).toHaveCount(0)

    // Trigger rebuild. The mock flips to progress responses on subsequent fetches.
    serverState = "progress"
    await page.getByRole("button", { name: /Rebuild summary cache/i }).click()

    await expect(catchupStrip).toBeVisible({ timeout: 5_000 })
    await expect(catchupStrip).toContainText(/Rebuilding summary cache/)
    await expect(catchupStrip).toContainText(/Rebuild in progress/)
    await expect(dashboard).toBeVisible()
    await expect(fullProgress).toHaveCount(0)
  })
})
