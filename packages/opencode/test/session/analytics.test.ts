import { describe, expect, test } from "bun:test"
import { Analytics } from "../../src/session/analytics"
import { AnalyticsOverrides } from "../../src/session/analytics-overrides"
import type { ModelsDev } from "../../src/provider/models"

const now = Date.UTC(2026, 4, 5, 12, 0, 0)

function record(input: Partial<Analytics.UsageRecord> = {}): Analytics.UsageRecord {
  const tokens = input.tokens ?? {
    freshInput: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }
  return {
    messageID: input.messageID ?? "msg_1",
    sessionID: input.sessionID ?? "ses_1",
    sessionTitle: input.sessionTitle ?? "Test session",
    directory: input.directory ?? "/repo/alpha",
    projectID: input.projectID ?? "proj_alpha",
    projectWorktree: input.projectWorktree ?? "/repo/alpha",
    projectName: input.projectName,
    providerID: input.providerID ?? "openai",
    modelID: input.modelID ?? "gpt-test",
    agent: input.agent ?? "build",
    createdAt: input.createdAt ?? now,
    actualCost: input.actualCost ?? 0,
    tokens,
  }
}

const stdRates: Analytics.RatesLookup = () => ({ input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 })
const noRates: Analytics.RatesLookup = () => undefined

describe("Analytics.summarizeRecords core math", () => {
  test("keeps fresh input separate from cache buckets for token and pricing totals", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "anthropic",
          tokens: {
            freshInput: 1_000_000,
            output: 100_000,
            reasoning: 50_000,
            cacheRead: 2_000_000,
            cacheWrite: 500_000,
            total: 3_650_000,
          },
        }),
      ],
      { period: "30d" },
      () => ({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }),
      now,
    )

    expect(summary.totals.tokens.freshInput).toBe(1_000_000)
    expect(summary.totals.tokens.cacheRead).toBe(2_000_000)
    expect(summary.totals.tokens.cacheWrite).toBe(500_000)
    expect(summary.totals.apiEquivalentCost.amount).toBe(5.15)
    expect(summary.totals.apiEquivalentCostBuckets.freshInput.amount).toBe(2)
    expect(summary.totals.apiEquivalentCostBuckets.cacheRead.amount).toBe(0.4)
  })

  test("computes API-equivalent cost even when actual recorded cost is zero", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          actualCost: 0,
          tokens: {
            freshInput: 1_000_000,
            output: 1_000_000,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 2_000_000,
          },
        }),
      ],
      { period: "30d" },
      () => ({ input: 1.25, output: 10, cacheRead: 0, cacheWrite: 0 }),
      now,
    )

    expect(summary.totals.actualCost).toBe(0)
    expect(summary.totals.apiEquivalentCost.amount).toBe(11.25)
    expect(summary.totals.apiEquivalentCost.knownResponses).toBe(1)
    expect(summary.totals.apiEquivalentCost.unknownResponses).toBe(0)
  })

  test("labels API-equivalent cost as partial when standard pricing is unknown", () => {
    const summary = Analytics.summarizeRecords(
      [record({ messageID: "known", modelID: "known" }), record({ messageID: "unknown", modelID: "unknown" })],
      { period: "30d" },
      (_, modelID) => (modelID === "known" ? { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } : undefined),
      now,
    )

    expect(summary.totals.apiEquivalentCost.knownResponses).toBe(1)
    expect(summary.totals.apiEquivalentCost.unknownResponses).toBe(1)
  })
})

describe("Analytics.summarizeRecords project default", () => {
  test("global query returns every project with usage when no filter is applied", () => {
    const records = [
      record({ messageID: "alpha-1", directory: "/repo/alpha", projectWorktree: "/repo/alpha", projectName: "Alpha" }),
      record({ messageID: "alpha-2", directory: "/repo/alpha", projectWorktree: "/repo/alpha", projectName: "Alpha" }),
      record({ messageID: "beta-1", directory: "/repo/beta", projectWorktree: "/repo/beta", projectName: "Beta" }),
      record({ messageID: "beta-2", directory: "/repo/beta", projectWorktree: "/repo/beta", projectName: "Beta" }),
      record({ messageID: "gamma-1", directory: "/repo/gamma", projectWorktree: "/repo/gamma", projectName: "Gamma" }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "30d" }, stdRates, now)

    expect(summary.totals.calls).toBe(5)
    // Every project must show up in the breakdown when no filter is applied.
    const projectIds = summary.breakdowns.byProject.map((row) => row.id).sort()
    expect(projectIds).toEqual(["/repo/alpha", "/repo/beta", "/repo/gamma"])
    // availableProjects must list all projects regardless of any filter.
    const availableIds = summary.availableProjects.map((p) => p.id).sort()
    expect(availableIds).toEqual(["/repo/alpha", "/repo/beta", "/repo/gamma"])
  })

  test("project filter narrows interactive breakdowns but keeps availableProjects exhaustive", () => {
    const records = [
      record({ messageID: "alpha-1", directory: "/repo/alpha", projectWorktree: "/repo/alpha", projectName: "Alpha" }),
      record({ messageID: "beta-1", directory: "/repo/beta", projectWorktree: "/repo/beta", projectName: "Beta" }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "30d", project: "/repo/alpha" }, stdRates, now)

    expect(summary.totals.calls).toBe(1)
    expect(summary.breakdowns.byProject.map((r) => r.id).sort()).toEqual(["/repo/alpha", "/repo/beta"])
    expect(summary.availableProjects.map((p) => p.id).sort()).toEqual(["/repo/alpha", "/repo/beta"])
  })
})

describe("Analytics.summarizeRecords cross-filter exclude-self behavior", () => {
  test("model filter narrows KPIs but byModel still shows all models so user can switch", () => {
    const records = [
      record({ messageID: "a", modelID: "m1", agent: "build" }),
      record({ messageID: "b", modelID: "m1", agent: "investigator" }),
      record({ messageID: "c", modelID: "m2", agent: "build" }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "30d", model: "openai/m1" }, stdRates, now)
    expect(summary.totals.calls).toBe(2)
    // byModel must still list every model so the user can pick a different one without
    // first clearing the chip.
    expect(summary.breakdowns.byModel.map((r) => r.id).sort()).toEqual(["openai/m1", "openai/m2"])
    // byAgent applies the model filter (only build + investigator from m1 calls).
    const agents = summary.breakdowns.byAgent.map((r) => r.id).sort()
    expect(agents).toEqual(["build", "investigator"])
  })

  test("agent filter excludes itself from byAgent but applies to other panels", () => {
    const records = [
      record({ messageID: "a", agent: "build", modelID: "m1" }),
      record({ messageID: "b", agent: "orchestrator", modelID: "m1" }),
      record({ messageID: "c", agent: "build", modelID: "m2" }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "30d", agent: "build" }, stdRates, now)
    expect(summary.totals.calls).toBe(2)
    expect(summary.breakdowns.byAgent.map((r) => r.id).sort()).toEqual(["build", "orchestrator"])
    // byModel narrows to only build's models.
    expect(summary.breakdowns.byModel.map((r) => r.id).sort()).toEqual(["openai/m1", "openai/m2"])
  })

  test("day filter narrows other panels to that day", () => {
    const day1 = Date.UTC(2026, 4, 1, 12, 0, 0)
    const day2 = Date.UTC(2026, 4, 3, 12, 0, 0)
    const records = [
      record({ messageID: "a", createdAt: day1, modelID: "m1" }),
      record({ messageID: "b", createdAt: day2, modelID: "m2" }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "allTime", day: "2026-05-01" }, stdRates, now)
    expect(summary.totals.calls).toBe(1)
    expect(summary.breakdowns.byModel.map((r) => r.id)).toEqual(["openai/m1"])
    // byDay still shows both days so the user can switch focus.
    expect(summary.breakdowns.byDay.map((r) => r.id).sort()).toEqual(["2026-05-01", "2026-05-03"])
  })
})

describe("Analytics.summarizeRecords cache hit rate", () => {
  test("returns 0 when there is no input traffic", () => {
    const summary = Analytics.summarizeRecords(
      [record({ tokens: { freshInput: 0, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 100 } })],
      { period: "30d" },
      stdRates,
      now,
    )
    expect(summary.totals.cacheHitRate).toBe(0)
  })

  test("reports cache_read / (fresh_input + cache_read)", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          tokens: {
            freshInput: 100,
            output: 0,
            reasoning: 0,
            cacheRead: 900,
            cacheWrite: 0,
            total: 1000,
          },
        }),
      ],
      { period: "30d" },
      stdRates,
      now,
    )
    expect(summary.totals.cacheHitRate).toBeCloseTo(0.9)
  })
})

describe("Analytics.summarizeRecords pricing coverage", () => {
  test("hides the surface when every model has full standard pricing", () => {
    const summary = Analytics.summarizeRecords([record()], { period: "30d" }, stdRates, now)
    expect(summary.coverage.hasGaps).toBe(false)
    expect(summary.coverage.gaps).toEqual([])
  })

  test("flags fully unpriced models and sorts by usage volume", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({ messageID: "x", modelID: "no-price", tokens: { freshInput: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 100 } }),
        record({ messageID: "y", modelID: "no-price", tokens: { freshInput: 50, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 50 } }),
        record({ messageID: "z", modelID: "tiny", tokens: { freshInput: 10, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10 } }),
      ],
      { period: "30d" },
      noRates,
      now,
    )
    expect(summary.coverage.hasGaps).toBe(true)
    expect(summary.coverage.gaps[0]?.model).toBe("no-price")
    expect(summary.coverage.gaps[0]?.kind).toBe("unpriced")
    expect(summary.coverage.gaps[0]?.tokens).toBe(150)
    expect(summary.coverage.gaps[0]?.calls).toBe(2)
  })

  test("flags partial coverage when usage hits a zero rate", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          messageID: "p1",
          modelID: "no-cache",
          tokens: { freshInput: 100, output: 100, reasoning: 0, cacheRead: 1000, cacheWrite: 0, total: 1200 },
        }),
      ],
      { period: "30d" },
      () => ({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }),
      now,
    )
    expect(summary.coverage.hasGaps).toBe(true)
    const gap = summary.coverage.gaps.find((g) => g.model === "no-cache")
    expect(gap?.kind).toBe("partial")
  })

  test("reports actual provider cost as missingApiEquivalent for unpriced models", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          messageID: "u1",
          modelID: "no-price",
          actualCost: 0.42,
          tokens: { freshInput: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 100 },
        }),
        record({
          messageID: "u2",
          modelID: "no-price",
          actualCost: 1.58,
          tokens: { freshInput: 200, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 200 },
        }),
      ],
      { period: "30d" },
      noRates,
      now,
    )
    const gap = summary.coverage.gaps.find((g) => g.model === "no-price")
    expect(gap?.missingApiEquivalent).toBeCloseTo(2)
  })

  test("computes the uncovered share of partial coverage as missingApiEquivalent", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          messageID: "p1",
          modelID: "no-cache",
          actualCost: 1, // recorded provider bill
          tokens: { freshInput: 1_000_000, output: 0, reasoning: 0, cacheRead: 1_000_000, cacheWrite: 0, total: 2_000_000 },
        }),
      ],
      { period: "30d" },
      // input has a rate but cacheRead is missing — covered = 0.5, missing = 0.5.
      () => ({ input: 0.5, output: 0, cacheRead: 0, cacheWrite: 0 }),
      now,
    )
    const gap = summary.coverage.gaps.find((g) => g.model === "no-cache")
    expect(gap?.missingApiEquivalent).toBeCloseTo(0.5)
  })
})

describe("Analytics.summarizeRecords provider cache pricing", () => {
  test("prices OpenAI cache write as input plus distinct write operation", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "openai",
          tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 1_000_000, total: 1_000_000 },
        }),
      ],
      { period: "30d" },
      () => ({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6 }),
      now,
    )

    expect(summary.totals.apiEquivalentCost.amount).toBe(11)
    expect(summary.totals.apiEquivalentCostBuckets.cacheWrite.amount).toBe(11)
  })

  test("does not double bill OpenAI cache-write tokens as fresh input", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "openai",
          tokens: { freshInput: 1_000_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 1_000_000, total: 2_000_000 },
        }),
      ],
      { period: "30d" },
      () => ({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6 }),
      now,
    )

    expect(summary.totals.apiEquivalentCost.amount).toBe(16)
    expect(summary.totals.apiEquivalentCostBuckets.freshInput.amount).toBe(5)
    expect(summary.totals.apiEquivalentCostBuckets.cacheWrite.amount).toBe(11)
  })

  test("prices Anthropic cache write as bundled 5-minute creation, not input plus write again", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "anthropic",
          tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 1_000_000, total: 1_000_000 },
        }),
      ],
      { period: "30d" },
      () => ({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }),
      now,
    )

    expect(summary.totals.apiEquivalentCost.amount).toBe(3.75)
    expect(summary.totals.apiEquivalentCostBuckets.cacheWrite.amount).toBe(3.75)
  })

  test("marks cache-write usage partial when the cache-write rate is missing", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "openai",
          modelID: "missing-cache-write",
          tokens: { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 1_000_000, total: 1_000_000 },
        }),
      ],
      { period: "30d" },
      () => ({ input: 5, output: 25, cacheRead: 0.5 }),
      now,
    )

    expect(summary.totals.apiEquivalentCost.knownResponses).toBe(0)
    expect(summary.totals.apiEquivalentCost.unknownResponses).toBe(1)
    expect(summary.coverage.hasGaps).toBe(true)
    expect(summary.coverage.gaps[0]?.kind).toBe("partial")
  })
})

describe("Analytics.summarizeRecords dominant attribution per breakdown row", () => {
  test("annotates each day with its dominant model, project, and agent", () => {
    const day = Date.UTC(2026, 4, 5, 12, 0, 0)
    const records = [
      record({
        messageID: "a",
        modelID: "m1",
        agent: "build",
        directory: "/repo/alpha",
        projectWorktree: "/repo/alpha",
        projectName: "Alpha",
        createdAt: day,
        tokens: { freshInput: 0, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 100 },
      }),
      record({
        messageID: "b",
        modelID: "m1",
        agent: "build",
        directory: "/repo/alpha",
        projectWorktree: "/repo/alpha",
        projectName: "Alpha",
        createdAt: day,
        tokens: { freshInput: 0, output: 5_000, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 5_000 },
      }),
      record({
        messageID: "c",
        modelID: "m2",
        agent: "investigator",
        directory: "/repo/beta",
        projectWorktree: "/repo/beta",
        projectName: "Beta",
        createdAt: day,
        tokens: { freshInput: 0, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 50 },
      }),
    ]
    const summary = Analytics.summarizeRecords(records, { period: "allTime" }, stdRates, now)
    const dayRow = summary.breakdowns.byDay[0]
    expect(dayRow?.topModel?.id).toBe("openai/m1")
    expect(dayRow?.topProject?.label).toBe("Alpha")
    expect(dayRow?.topAgent?.id).toBe("build")
  })
})

describe("Analytics.buildLookup with overrides", () => {
  const fakeCatalog: Record<string, ModelsDev.Provider> = {
    openai: {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      models: {
        "gpt-real": {
          id: "gpt-real",
          name: "Real",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6 },
          limit: { context: 200_000, output: 8_000 },
          options: {},
        },
      },
    },
  }

  test("direct rates override the catalog", () => {
    const overrides = AnalyticsOverrides.resolve({
      rates: [{ provider: "anthropic", model: "claude-future", input: 12, output: 60 }],
    })
    const lookup = Analytics.buildLookup(fakeCatalog, overrides)
    expect(lookup("anthropic", "claude-future")).toEqual({ input: 12, output: 60 })
  })

  test("alias maps an unknown model to a catalog entry", () => {
    const overrides = AnalyticsOverrides.resolve({
      aliases: [{ match: { provider: "openai", model: "gpt-real-fast" }, as: { provider: "openai", model: "gpt-real" } }],
    })
    const lookup = Analytics.buildLookup(fakeCatalog, overrides)
    expect(lookup("openai", "gpt-real-fast")).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6 })
  })

  test("alias falls back to undefined if the alias target is also unknown", () => {
    const overrides = AnalyticsOverrides.resolve({
      aliases: [{ match: { provider: "openai", model: "from" }, as: { provider: "openai", model: "still-unknown" } }],
    })
    const lookup = Analytics.buildLookup(fakeCatalog, overrides)
    expect(lookup("openai", "from")).toBeUndefined()
  })

  test("direct rate beats alias when both match", () => {
    const overrides = AnalyticsOverrides.resolve({
      aliases: [{ match: { provider: "openai", model: "winner" }, as: { provider: "openai", model: "gpt-real" } }],
      rates: [{ provider: "openai", model: "winner", input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 }],
    })
    const lookup = Analytics.buildLookup(fakeCatalog, overrides)
    expect(lookup("openai", "winner")).toEqual({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 })
  })

  test("models with neither a catalog entry nor an override fall back to undefined", () => {
    const overrides = AnalyticsOverrides.resolve(undefined)
    const lookup = Analytics.buildLookup(fakeCatalog, overrides)
    expect(lookup("openai", "missing")).toBeUndefined()
  })
})

describe("Analytics V2.1 persistent summary implementation", () => {
  test("summary store uses a tuple watermark and atomic chunk writes for resumable incremental fold-in", async () => {
    const store = await Bun.file(new URL("../../src/session/analytics-store.ts", import.meta.url)).text()
    const migration = await Bun.file(new URL("../../migration/20260505093000_analytics_v2_1_summary/migration.sql", import.meta.url)).text()

    expect(migration).toContain("`last_time_created` integer DEFAULT 0 NOT NULL")
    expect(migration).toContain("`last_message_id` text DEFAULT '' NOT NULL")
    expect(store).toContain("Database.transaction")
    expect(store).toContain("gt(MessageTable.id, afterID)")
    expect(store).toContain("last_message_id: maxMessageID")
  })

  test("summary store persists tokens and actual cost but not API-equivalent dollars", async () => {
    const schema = await Bun.file(new URL("../../src/session/analytics-summary.sql.ts", import.meta.url)).text()

    expect(schema).toContain("actual_cost")
    expect(schema).toContain("fresh_input")
    expect(schema).not.toContain("api_equivalent")
  })

  test("normal analytics summary path reads overrides before building from the store", async () => {
    const source = await Bun.file(new URL("../../src/session/analytics.ts", import.meta.url)).text()

    expect(source).toContain("AnalyticsOverrides.loadResolved()")
    expect(source).toContain("summaryFromStore(query, lookup, now)")
    expect(source).toContain("computeApiEquiv(row.provider, tokens, rates")
  })

  test("rebuild escape hatch clears all summary tables and watermark", async () => {
    const store = await Bun.file(new URL("../../src/session/analytics-store.ts", import.meta.url)).text()

    expect(store).toContain("export function rebuild")
    expect(store).toContain("db.delete(AnalyticsDailyTable)")
    expect(store).toContain("db.delete(AnalyticsSessionTable)")
    expect(store).toContain("db.delete(AnalyticsResponseTable)")
    expect(store).toContain("db.delete(AnalyticsWatermarkTable)")
  })
})
