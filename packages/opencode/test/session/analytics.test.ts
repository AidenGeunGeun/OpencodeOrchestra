import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { ProjectTable } from "../../src/project/project.sql"
import { Analytics } from "../../src/session/analytics"
import { AnalyticsOverrides } from "../../src/session/analytics-overrides"
import { AnalyticsTokenMigration } from "../../src/session/analytics-token-migration"
import { AnalyticsStore } from "../../src/session/analytics-store"
import { AnalyticsResponseTable, AnalyticsTokenMigrationStateTable } from "../../src/session/analytics-summary.sql"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import type { ModelsDev } from "../../src/provider/models"
import {
  FIXTURE_NOW,
  fixtureRates,
  installAnalyticsFixture,
  resetAnalyticsFixture,
} from "./fixtures/analytics-7700-fixture"

const ANALYTICS_FIXTURE_MANIFEST = await Bun.file(new URL("./fixtures/analytics-7700-manifest.json", import.meta.url)).json()
const ANALYTICS_PRE_MIGRATION_MANIFEST = await Bun.file(
  new URL("./fixtures/analytics-7700-pre-migration-manifest.json", import.meta.url),
).json()

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

  test("excludes subscription providers from actual cost while preserving API-equivalent value", () => {
    const summary = Analytics.summarizeRecords(
      [
        record({
          providerID: "opencode-go",
          actualCost: 9.99,
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
      () => ({ input: 2, output: 8, cacheRead: 0, cacheWrite: 0 }),
      now,
    )

    expect(summary.totals.actualCost).toBe(0)
    expect(summary.totals.apiEquivalentCost.amount).toBe(10)
    expect(summary.breakdowns.byModel[0].actualCost).toBe(0)
    expect(summary.highImpact.responses[0].actualCost).toBe(0)
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
    // byBucket still shows both days so the user can switch focus.
    expect(summary.breakdowns.byBucket.map((r) => r.id).sort()).toEqual(["2026-05-01", "2026-05-03"])
  })
})

describe("Analytics.summarizeRecords adaptive time buckets", () => {
  test("uses hourly buckets for today and four-hour buckets for 7d", () => {
    const today = Analytics.summarizeRecords([record({ createdAt: now })], { period: "today" }, stdRates, now)
    expect(today.breakdowns.byBucket).toHaveLength(24)
    expect(today.breakdowns.byBucket.every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(row.id))).toBe(true)
    expect(today.breakdowns.byBucket.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day ?? ""))).toBe(true)

    const sevenDays = Analytics.summarizeRecords([record({ createdAt: now })], { period: "7d" }, stdRates, now)
    expect(sevenDays.breakdowns.byBucket).toHaveLength(42)
    expect(sevenDays.breakdowns.byBucket.every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(row.id))).toBe(true)
  })

  test("uses daily buckets for 30d, this month, and all time", () => {
    const older = Date.UTC(2026, 4, 1, 12, 0, 0)
    const records = [record({ messageID: "old", createdAt: older }), record({ messageID: "new", createdAt: now })]

    for (const period of ["30d", "thisMonth", "allTime"] as const) {
      const summary = Analytics.summarizeRecords(records, { period }, stdRates, now)
      expect(summary.breakdowns.byBucket.length).toBeGreaterThan(1)
      expect(summary.breakdowns.byBucket.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.id))).toBe(true)
    }
  })
})

describe("AnalyticsStore streamed placeholder readiness", () => {
  function assistant(input: { completed?: number; finish?: string; tokens?: number; created?: number }) {
    const created = input.created ?? now
    return {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      time: { created, ...(input.completed !== undefined ? { completed: input.completed } : {}) },
      parentID: "msg_parent",
      modelID: "gpt-test",
      providerID: "openai",
      mode: "build",
      agent: "build",
      path: { cwd: "/repo/alpha", root: "/repo/alpha" },
      cost: 0,
      tokens: {
        input: input.tokens ?? 0,
        output: input.tokens ?? 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      ...(input.finish !== undefined ? { finish: input.finish } : {}),
    } as const
  }

  test("does not fold a streamed placeholder before a completion signal", () => {
    expect(AnalyticsStore.isFoldableAssistantMessage(assistant({}))).toBe(false)
    expect(AnalyticsStore.isFoldableAssistantMessage(assistant({ completed: now, tokens: 0 }))).toBe(true)
    expect(AnalyticsStore.isFoldableAssistantMessage(assistant({ finish: "stop", tokens: 0 }))).toBe(true)
    expect(AnalyticsStore.isFoldableAssistantMessage(assistant({ created: Date.now(), finish: "stop", tokens: 0 }))).toBe(true)
    expect(AnalyticsStore.isFoldableAssistantMessage(assistant({ created: Date.now(), finish: "tool-calls", tokens: 0 }))).toBe(false)
  })

  test("incremental fold skips a placeholder and later matches rebuild after completion", async () => {
    const projectID = "proj_analytics_stream"
    const sessionID = "ses_analytics_stream"
    const messageID = "msg_analytics_stream"
    const activeNow = Date.now()
    const placeholder = assistant({ created: activeNow })
    const completed = assistant({ created: activeNow, completed: activeNow + 1000, tokens: 100 })
    const { id: _placeholderID, sessionID: _placeholderSessionID, ...placeholderData } = placeholder
    const { id: _completedID, sessionID: _completedSessionID, ...completedData } = completed

    Database.use((db) => {
      db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
    })
    AnalyticsStore.rebuild()

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: "/repo/analytics-stream",
          vcs: "git",
          name: "Analytics Stream",
          time_created: activeNow,
          time_updated: activeNow,
          sandboxes: [],
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "analytics-stream",
          directory: "/repo/analytics-stream",
          title: "Analytics Stream",
          version: "test",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(MessageTable)
        .values({
          id: messageID,
          session_id: sessionID,
          time_created: now,
          time_updated: now,
          data: placeholderData,
        })
        .run()
    })

    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    expect(AnalyticsStore.queryResponses().some((row) => row.message_id === messageID)).toBe(false)

    Database.use((db) => {
      db.update(MessageTable)
        .set({ data: completedData, time_updated: activeNow + 1000 })
        .where(eq(MessageTable.id, messageID))
        .run()
    })
    await AnalyticsStore.ensureBackfilled()
    const incremental = AnalyticsStore.queryResponses().find((row) => row.message_id === messageID)
    expect(incremental?.output).toBe(100)

    AnalyticsStore.rebuild()
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    const rebuilt = AnalyticsStore.queryResponses().find((row) => row.message_id === messageID)
    expect(rebuilt?.output).toBe(incremental?.output)
    expect(rebuilt?.actual_cost).toBe(incremental?.actual_cost)

    Database.use((db) => {
      db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
    })
    AnalyticsStore.rebuild()
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
    const dayRow = summary.breakdowns.byBucket.find((row) => row.id === "2026-05-05")
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
    const store = await Bun.file(new URL("../../src/session/analytics-store.ts", import.meta.url)).text()

    expect(schema).toContain("actual_cost")
    expect(schema).toContain("fresh_input")
    expect(schema).not.toContain("api_equivalent")
    expect(schema).not.toContain("session_count")
    expect(store).not.toContain("session_count")
  })

  test("session_count is dropped by a forward migration", async () => {
    const migration = await Bun.file(new URL("../../migration/20260514120000_drop_analytics_session_count/migration.sql", import.meta.url)).text()

    expect(migration).toContain("ALTER TABLE `analytics_daily` DROP COLUMN `session_count`")
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
    expect(store).toContain("db.delete(AnalyticsSkippedResponseTable)")
    expect(store).toContain("db.delete(AnalyticsWatermarkTable)")
  })

  test("fixture cleanup tooling is dry-run, backup, approval, and manifest gated", async () => {
    const source = await Bun.file(new URL("../../src/cli/cmd/db.ts", import.meta.url)).text()

    expect(source).toContain("analytics-preflight")
    expect(source).toContain("analytics-fixture-cleanup")
    expect(source).toContain("approve-fixture-cleanup")
    expect(source).toContain("Refusing fixture cleanup without --backup")
    expect(source).toContain("fixtureCountsMatch")
    expect(source).toContain("COPYFILE_EXCL")
  })
})

function clearTokenMigrationState() {
  Database.use((db) => {
    db.delete(AnalyticsTokenMigrationStateTable).where(eq(AnalyticsTokenMigrationStateTable.id, AnalyticsTokenMigration.ID)).run()
  })
}

function migrationTestTokens(input = 10) {
  return { input, output: input + 1, reasoning: input + 2, cache: { read: input + 3, write: input + 4 } }
}

function insertMigrationCase(input: {
  projectID: string
  sessionID: string
  messageID: string
  messageTokens: ReturnType<typeof migrationTestTokens>
  parts: any[]
}) {
  Database.use((db) => {
    db.delete(ProjectTable).where(eq(ProjectTable.id, input.projectID)).run()
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: `/tmp/${input.projectID}`,
        vcs: "git",
        name: input.projectID,
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .run()
    db.insert(SessionTable)
      .values({
        id: input.sessionID,
        project_id: input.projectID,
        slug: input.sessionID,
        directory: `/tmp/${input.projectID}`,
        title: input.sessionID,
        version: "test",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(MessageTable)
      .values({
        id: input.messageID,
        session_id: input.sessionID,
        time_created: now,
        time_updated: now,
        data: ({
          role: "assistant",
          parentID: `user_${input.messageID}`,
          mode: "build",
          agent: "build",
          path: { cwd: `/tmp/${input.projectID}`, root: `/tmp/${input.projectID}` },
          cost: 1.23,
          tokens: input.messageTokens,
          modelID: "gpt-test",
          providerID: "openai",
          finish: "stop",
          time: { created: now, completed: now + 1 },
        } as any),
      })
      .run()
    for (const [index, part] of input.parts.entries()) {
      db.insert(PartTable)
        .values({
          id: `${input.messageID}_part_${index}`,
          message_id: input.messageID,
          session_id: input.sessionID,
          time_created: now + index,
          time_updated: now + index,
          data: part as any,
        })
        .run()
    }
  })
}

function readMessageTokens(messageID: string) {
  return (Database.use((db) => db.select({ data: MessageTable.data }).from(MessageTable).where(eq(MessageTable.id, messageID)).get())!
    .data as any).tokens
}

describe("AnalyticsTokenMigration", () => {
  test("rewrites multi-step assistant tokens from step-finish parts", async () => {
    clearTokenMigrationState()
    AnalyticsStore.rebuild()
    const projectID = "proj_migration_core"
    const sessionID = "ses_migration_core"
    const messageID = "msg_migration_core"
    const parts = [migrationTestTokens(10), migrationTestTokens(20), migrationTestTokens(30)]
    insertMigrationCase({
      projectID,
      sessionID,
      messageID,
      messageTokens: parts[2],
      parts: parts.map((tokens) => ({ type: "step-finish", reason: "stop", cost: 0.1, tokens })),
    })

    const result = await AnalyticsTokenMigration.ensureCompleted()
    expect(result.skipped).toBe(false)
    expect((result as any).summary.rewritten).toBe(1)
    expect(readMessageTokens(messageID)).toEqual({ input: 60, output: 63, reasoning: 66, cache: { read: 69, write: 72 } })

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    clearTokenMigrationState()
  })

  test("leaves rows with zero step-finish parts unchanged", async () => {
    clearTokenMigrationState()
    AnalyticsStore.rebuild()
    const projectID = "proj_migration_zero"
    const messageID = "msg_migration_zero"
    const tokens = migrationTestTokens(40)
    insertMigrationCase({ projectID, sessionID: "ses_migration_zero", messageID, messageTokens: tokens, parts: [] })

    const result = await AnalyticsTokenMigration.ensureCompleted()
    expect((result as any).summary.skipped.noStepFinish).toBe(1)
    expect(readMessageTokens(messageID)).toEqual(tokens)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    clearTokenMigrationState()
  })

  test("leaves rows with one step-finish part unchanged", async () => {
    clearTokenMigrationState()
    AnalyticsStore.rebuild()
    const projectID = "proj_migration_one"
    const messageID = "msg_migration_one"
    const tokens = migrationTestTokens(50)
    insertMigrationCase({
      projectID,
      sessionID: "ses_migration_one",
      messageID,
      messageTokens: tokens,
      parts: [{ type: "step-finish", reason: "stop", cost: 0.1, tokens }],
    })

    const result = await AnalyticsTokenMigration.ensureCompleted()
    expect((result as any).summary.skipped.singleStepFinish).toBe(1)
    expect(readMessageTokens(messageID)).toEqual(tokens)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    clearTokenMigrationState()
  })

  test("leaves rows with corrupt step-finish token data unchanged", async () => {
    clearTokenMigrationState()
    AnalyticsStore.rebuild()
    const projectID = "proj_migration_corrupt"
    const messageID = "msg_migration_corrupt"
    const tokens = migrationTestTokens(60)
    insertMigrationCase({
      projectID,
      sessionID: "ses_migration_corrupt",
      messageID,
      messageTokens: tokens,
      parts: [
        { type: "step-finish", reason: "stop", cost: 0.1, tokens: migrationTestTokens(1) },
        { type: "step-finish", reason: "stop", cost: 0.1, tokens: { input: "bad" } },
      ],
    })

    const result = await AnalyticsTokenMigration.ensureCompleted()
    expect((result as any).summary.skipped.corruptStepFinish).toBe(1)
    expect(readMessageTokens(messageID)).toEqual(tokens)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    clearTokenMigrationState()
  })

  test("completed migration state is a no-op and does not clear summaries", async () => {
    clearTokenMigrationState()
    Database.use((db) => {
      db.insert(AnalyticsTokenMigrationStateTable)
        .values({ id: AnalyticsTokenMigration.ID, status: "completed", processed_messages: 1, total_messages: 1, updated_at: now })
        .run()
      db.insert(AnalyticsResponseTable)
        .values({
          message_id: "msg_noop_response",
          session_id: "ses_noop_response",
          title: "noop",
          directory: "/tmp/noop",
          project_key: "/tmp/noop",
          project_label: "noop",
          provider: "openai",
          model: "gpt-test",
          agent: "build",
          created_at: now,
        })
        .run()
    })

    const result = await AnalyticsTokenMigration.ensureCompleted()
    expect(result.skipped).toBe(true)
    expect(AnalyticsStore.queryResponses().some((row) => row.message_id === "msg_noop_response")).toBe(true)

    Database.use((db) => {
      db.delete(AnalyticsResponseTable).where(eq(AnalyticsResponseTable.message_id, "msg_noop_response")).run()
    })
    clearTokenMigrationState()
  })

  test("in-progress migration state resumes and completes with corrected rows", async () => {
    clearTokenMigrationState()
    AnalyticsStore.rebuild()
    const projectID = "proj_migration_resume"
    const messageID = "msg_migration_resume"
    const parts = [migrationTestTokens(2), migrationTestTokens(3)]
    insertMigrationCase({
      projectID,
      sessionID: "ses_migration_resume",
      messageID,
      messageTokens: parts[1],
      parts: parts.map((tokens) => ({ type: "step-finish", reason: "stop", cost: 0.1, tokens })),
    })
    Database.use((db) => {
      db.insert(AnalyticsTokenMigrationStateTable)
        .values({ id: AnalyticsTokenMigration.ID, status: "in_progress", processed_messages: 0, total_messages: 1, updated_at: now })
        .run()
    })

    await AnalyticsTokenMigration.ensureCompleted()
    expect(readMessageTokens(messageID)).toEqual({ input: 5, output: 7, reasoning: 9, cache: { read: 11, write: 13 } })
    expect(AnalyticsTokenMigration.state()).toBe("completed")

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    clearTokenMigrationState()
  })
})

describe("AnalyticsStore placeholder stall fix", () => {
  test("store status stays backfilling when the first row after the watermark is an active placeholder", async () => {
    const projectID = "proj_analytics_stall_ready"
    const sessionID = "ses_analytics_stall_ready"
    const messageID = "msg_analytics_stall_ready"
    const activeNow = Date.now()
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/stall-ready", vcs: "git", name: "stall", time_created: activeNow, time_updated: activeNow, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/stall-ready", title: "stall", version: "test", time_created: activeNow, time_updated: activeNow })
        .run()
      db.insert(MessageTable)
        .values({
          id: messageID,
          session_id: sessionID,
          time_created: activeNow,
          time_updated: activeNow,
          data: ({
            role: "assistant",
            parentID: "user_stall",
            mode: "build",
            agent: "build",
            path: { cwd: "/tmp/stall-ready", root: "/tmp/stall-ready" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "gpt-test",
            providerID: "openai",
            time: { created: activeNow },
          } as any),
        })
        .run()
    })
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    expect(AnalyticsStore.storeStatus()).toBe("backfilling")
    expect(AnalyticsStore.readWatermark()?.last_message_id).toBe("")

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })

  test("stale unfinished zero-usage placeholders are skipped and do not block later completed rows", async () => {
    const projectID = "proj_analytics_stale_skip"
    const sessionID = "ses_analytics_stale_skip"
    const staleID = "msg_analytics_stale_skip"
    const completedID = "msg_analytics_after_stale"
    const staleAt = Date.now() - 2 * 60 * 60 * 1000
    const completedAt = staleAt + 1000
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/stale-skip", vcs: "git", name: "stale", time_created: staleAt, time_updated: staleAt, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/stale-skip", title: "stale", version: "test", time_created: staleAt, time_updated: completedAt })
        .run()
      db.insert(MessageTable)
        .values({
          id: staleID,
          session_id: sessionID,
          time_created: staleAt,
          time_updated: staleAt,
          data: ({ role: "assistant", parentID: "user_stale", mode: "build", agent: "build", path: { cwd: "/tmp/stale-skip", root: "/tmp/stale-skip" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, modelID: "gpt-test", providerID: "openai", time: { created: staleAt } } as any),
        })
        .run()
      db.insert(MessageTable)
        .values({
          id: completedID,
          session_id: sessionID,
          time_created: completedAt,
          time_updated: completedAt,
          data: ({ role: "assistant", parentID: "user_done", mode: "build", agent: "build", path: { cwd: "/tmp/stale-skip", root: "/tmp/stale-skip" }, cost: 0.01, tokens: migrationTestTokens(7), modelID: "gpt-test", providerID: "openai", finish: "stop", time: { created: completedAt, completed: completedAt } } as any),
        })
        .run()
    })
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    const responses = AnalyticsStore.queryResponses()
    expect(responses.some((row) => row.message_id === staleID)).toBe(false)
    expect(responses.find((row) => row.message_id === completedID)?.fresh_input).toBe(7)
    expect(AnalyticsStore.storeStatus()).toBe("ready")

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })

  test("provider call counts come from persisted step-finish parts", async () => {
    const projectID = "proj_analytics_provider_calls"
    const sessionID = "ses_analytics_provider_calls"
    const messageID = "msg_analytics_provider_calls"
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/provider-calls", vcs: "git", name: "calls", time_created: now, time_updated: now, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/provider-calls", title: "calls", version: "test", time_created: now, time_updated: now })
        .run()
      db.insert(MessageTable)
        .values({ id: messageID, session_id: sessionID, time_created: now, time_updated: now, data: ({ role: "assistant", parentID: "user_calls", mode: "build", agent: "build", path: { cwd: "/tmp/provider-calls", root: "/tmp/provider-calls" }, cost: 0.99, tokens: migrationTestTokens(99), modelID: "gpt-test", providerID: "openai", finish: "stop", time: { created: now, completed: now } } as any) })
        .run()
      for (const [index, input] of [2, 3, 4].entries()) {
        db.insert(PartTable)
          .values({ id: `${messageID}_step_${index}`, message_id: messageID, session_id: sessionID, time_created: now + index, time_updated: now + index, data: { type: "step-finish", reason: "stop", cost: 0.1, tokens: migrationTestTokens(input) } as any })
          .run()
      }
    })
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    const response = AnalyticsStore.queryResponses().find((row) => row.message_id === messageID)
    expect(response?.calls).toBe(3)
    expect(response?.fresh_input).toBe(9)
    expect(response?.actual_cost).toBeCloseTo(0.3)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })

  test("stale unfinished rows with step evidence are recovered instead of skipped", async () => {
    const projectID = "proj_analytics_stale_step"
    const sessionID = "ses_analytics_stale_step"
    const messageID = "msg_analytics_stale_step"
    const staleAt = Date.now() - 2 * 60 * 60 * 1000
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/stale-step", vcs: "git", name: "step", time_created: staleAt, time_updated: staleAt, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/stale-step", title: "step", version: "test", time_created: staleAt, time_updated: staleAt })
        .run()
      db.insert(MessageTable)
        .values({ id: messageID, session_id: sessionID, time_created: staleAt, time_updated: staleAt, data: ({ role: "assistant", parentID: "user_step", mode: "build", agent: "build", path: { cwd: "/tmp/stale-step", root: "/tmp/stale-step" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, modelID: "gpt-test", providerID: "openai", time: { created: staleAt } } as any) })
        .run()
      db.insert(PartTable)
        .values({ id: `${messageID}_step`, message_id: messageID, session_id: sessionID, time_created: staleAt, time_updated: staleAt, data: { type: "step-finish", reason: "stop", cost: 0.2, tokens: migrationTestTokens(8) } as any })
        .run()
    })
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    const response = AnalyticsStore.queryResponses().find((row) => row.message_id === messageID)
    expect(response?.fresh_input).toBe(8)
    expect(response?.calls).toBe(1)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })

  test("a new active placeholder after a ready watermark puts the summary back into backfilling", async () => {
    const projectID = "proj_analytics_ready_then_active"
    const sessionID = "ses_analytics_ready_then_active"
    const completedID = "msg_analytics_ready_done"
    const activeID = "msg_analytics_ready_active"
    const activeNow = Date.now()
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/ready-active", vcs: "git", name: "ready-active", time_created: activeNow, time_updated: activeNow, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/ready-active", title: "ready-active", version: "test", time_created: activeNow, time_updated: activeNow })
        .run()
      db.insert(MessageTable)
        .values({ id: completedID, session_id: sessionID, time_created: activeNow, time_updated: activeNow, data: ({ role: "assistant", parentID: "user_ready_done", mode: "build", agent: "build", path: { cwd: "/tmp/ready-active", root: "/tmp/ready-active" }, cost: 0.01, tokens: migrationTestTokens(3), modelID: "gpt-test", providerID: "openai", finish: "stop", time: { created: activeNow, completed: activeNow } } as any) })
        .run()
    })
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    expect(AnalyticsStore.storeStatus()).toBe("ready")
    Database.use((db) => {
      db.insert(MessageTable)
        .values({ id: activeID, session_id: sessionID, time_created: activeNow + 1, time_updated: activeNow + 1, data: ({ role: "assistant", parentID: "user_ready_active", mode: "build", agent: "build", path: { cwd: "/tmp/ready-active", root: "/tmp/ready-active" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, modelID: "gpt-test", providerID: "openai", time: { created: activeNow + 1 } } as any) })
        .run()
    })
    const response = await Analytics.summary({ period: "allTime" }, activeNow + 1)
    expect(response.backfilling?.total).toBe(2)
    expect(response.backfilling?.processed).toBe(1)
    expect(AnalyticsStore.queryResponses().some((row) => row.message_id === activeID)).toBe(false)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })
})

function normalizeForCompare(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeForCompare)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeForCompare(item)]))
}

function expectSummaryClose(actual: any, expected: any, path = "summary") {
  actual = normalizeForCompare(actual)
  expected = normalizeForCompare(expected)
  if (typeof actual === "number" || typeof expected === "number") {
    expect(typeof actual, `${path} actual type`).toBe("number")
    expect(typeof expected, `${path} expected type`).toBe("number")
    if (Number.isInteger(actual) && Number.isInteger(expected)) expect(actual, path).toBe(expected)
    else expect(Math.round(Math.abs(actual - expected) * 1_000_000), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1)
    return
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path} actual array`).toBe(true)
    expect(Array.isArray(expected), `${path} expected array`).toBe(true)
    expect(actual.length, `${path} length`).toBe(expected.length)
    for (let index = 0; index < actual.length; index++) expectSummaryClose(actual[index], expected[index], `${path}[${index}]`)
    return
  }
  if (actual && typeof actual === "object") {
    expect(Object.keys(actual).sort(), `${path} keys`).toEqual(Object.keys(expected).sort())
    for (const key of Object.keys(actual).sort()) expectSummaryClose(actual[key], expected[key], `${path}.${key}`)
    return
  }
  expect(actual, path).toEqual(expected)
}

describe("Analytics 7,700-row fixture", () => {
  test("fixture installer refuses to run without the test preload marker", () => {
    const prior = process.env["OCO_TEST_PRELOAD"]
    delete process.env["OCO_TEST_PRELOAD"]
    try {
      expect(() => installAnalyticsFixture()).toThrow("test preload marker")
    } finally {
      if (prior !== undefined) process.env["OCO_TEST_PRELOAD"] = prior
    }
  })

  test("manifest exposes deterministic post- and pre-migration reference values", () => {
    expect(ANALYTICS_FIXTURE_MANIFEST.rowCount).toBe(7_700)
    expect(ANALYTICS_FIXTURE_MANIFEST.rewrittenResponses).toBeGreaterThan(0)
    expect(ANALYTICS_FIXTURE_MANIFEST.skipped.corruptStepFinish).toBe(1)
    expect(ANALYTICS_FIXTURE_MANIFEST.referenceSession.postMigrationTokens.input).toBeGreaterThan(
      ANALYTICS_FIXTURE_MANIFEST.referenceSession.preMigrationTokens.input,
    )
    for (const period of ["today", "7d", "30d", "thisMonth", "allTime"] as const) {
      expect(ANALYTICS_FIXTURE_MANIFEST.periods[period].highImpactSessionID).toStartWith("ses_fx_")
      expect(ANALYTICS_FIXTURE_MANIFEST.periods[period].highImpactResponseID).toStartWith("msg_fx_")
    }
    expect(ANALYTICS_PRE_MIGRATION_MANIFEST.multiStepRows.length).toBeGreaterThan(1_000)
  })

  test("migration and summary rebuild match the fixture manifest", async () => {
    clearTokenMigrationState()
    installAnalyticsFixture()
    await AnalyticsTokenMigration.ensureCompleted()
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    const summary = Analytics.responseSummaryFromStoreForTest({ period: "allTime" }, fixtureRates, FIXTURE_NOW)

    expect(summary.totals.calls).toBe(ANALYTICS_FIXTURE_MANIFEST.periods.allTime.calls)
    expect(summary.totals.sessions).toBe(ANALYTICS_FIXTURE_MANIFEST.periods.allTime.sessions)
    expect(summary.totals.tokens).toEqual({
      freshInput: ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.input,
      output: ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.output,
      reasoning: ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.reasoning,
      cacheRead: ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.cache.read,
      cacheWrite: ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.cache.write,
      total:
        ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.input +
        ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.output +
        ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.reasoning +
        ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.cache.read +
        ANALYTICS_FIXTURE_MANIFEST.periods.allTime.tokens.cache.write,
    })
    const referenceTokens = AnalyticsStore.queryResponses()
      .filter((row) => row.session_id === ANALYTICS_FIXTURE_MANIFEST.referenceSession.sessionID)
      .reduce(
        (acc, row) => ({
          input: acc.input + row.fresh_input,
          output: acc.output + row.output,
          reasoning: acc.reasoning + row.reasoning,
          cache: { read: acc.cache.read + row.cache_read, write: acc.cache.write + row.cache_write },
        }),
        { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      )
    expect(referenceTokens).toEqual(ANALYTICS_FIXTURE_MANIFEST.referenceSession.postMigrationTokens)
    expect(summary.highImpact.sessions[0]?.sessionID).toBe(ANALYTICS_FIXTURE_MANIFEST.periods.allTime.highImpactSessionID)
    expect(summary.highImpact.responses[0]?.messageID).toBe(ANALYTICS_FIXTURE_MANIFEST.periods.allTime.highImpactResponseID)
    expect(AnalyticsStore.storeStatus()).toBe("ready")
    const hierarchy = ((Database.Client() as any).$client
      .query(
        "SELECT CASE WHEN s.parent_id IS NULL THEN 'topLevel' WHEN p.parent_id IS NULL THEN 'directChild' ELSE 'nestedDescendant' END AS kind, sum(ar.calls) AS calls, sum(ar.fresh_input + ar.output + ar.reasoning + ar.cache_read + ar.cache_write) AS tokens FROM analytics_response ar JOIN session s ON s.id = ar.session_id LEFT JOIN session p ON p.id = s.parent_id WHERE ar.session_id LIKE 'ses_fx_%' GROUP BY kind",
      )
      .all() as { kind: string; calls: number; tokens: number }[])
    const hierarchyMap = Object.fromEntries(hierarchy.map((row) => [row.kind, row]))
    expect(hierarchyMap.topLevel.calls).toBeGreaterThan(0)
    expect(hierarchyMap.directChild.calls).toBeGreaterThan(0)
    expect(hierarchyMap.nestedDescendant.calls).toBeGreaterThan(0)
    expect(hierarchy.reduce((acc, row) => acc + row.calls, 0)).toBe(summary.totals.calls)
    expect(hierarchy.reduce((acc, row) => acc + row.tokens, 0)).toBe(summary.totals.tokens.total)

    resetAnalyticsFixture()
    clearTokenMigrationState()
  })

  test("tiered summary path matches the all-response path across periods and filters", async () => {
    clearTokenMigrationState()
    installAnalyticsFixture()
    await AnalyticsTokenMigration.ensureCompleted()
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()

    const samples = ANALYTICS_FIXTURE_MANIFEST.filterSamples
    const periods = ["today", "7d", "30d", "thisMonth", "allTime"] as const
    const filters = [
      {},
      { project: samples.project },
      { model: samples.model },
      { agent: samples.agent },
      { day: samples.day },
      samples.combined,
    ]
    let assertions = 0
    for (const period of periods) {
      for (const filter of filters) {
        const query = { period, ...filter } as Analytics.Query
        const actual = Analytics.summaryFromStoreForTest(query, fixtureRates, FIXTURE_NOW)
        const expected = Analytics.responseSummaryFromStoreForTest(query, fixtureRates, FIXTURE_NOW)
        expectSummaryClose(actual, expected, `${period}:${JSON.stringify(filter)}`)
        assertions++
      }
    }
    expect(assertions).toBe(30)

    resetAnalyticsFixture()
    clearTokenMigrationState()
  })

  test("warm 30-day summary returns under 500ms on the deterministic fixture", async () => {
    clearTokenMigrationState()
    installAnalyticsFixture()
    await AnalyticsTokenMigration.ensureCompleted()
    AnalyticsStore.prepareBackfill()
    await AnalyticsStore.ensureBackfilled()
    Analytics.summaryFromStoreForTest({ period: "30d" }, fixtureRates, FIXTURE_NOW)
    const started = performance.now()
    Analytics.summaryFromStoreForTest({ period: "30d" }, fixtureRates, FIXTURE_NOW)
    expect(performance.now() - started).toBeLessThan(500)
    resetAnalyticsFixture()
    clearTokenMigrationState()
  })

  test("fresh rebuild stays within the per-row SQL statement budget", async () => {
    const projectID = "proj_sql_count"
    const sessionID = "ses_sql_count"
    const rowCount = 6
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({ id: projectID, worktree: "/tmp/sql-count", vcs: "git", name: "sql", time_created: now, time_updated: now, sandboxes: [] })
        .run()
      db.insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: sessionID, directory: "/tmp/sql-count", title: "sql", version: "test", time_created: now, time_updated: now })
        .run()
      for (let index = 0; index < rowCount; index++) {
        db.insert(MessageTable)
          .values({
            id: `msg_sql_count_${index}`,
            session_id: sessionID,
            time_created: now + index,
            time_updated: now + index,
            data: ({
              role: "assistant",
              parentID: `user_sql_count_${index}`,
              mode: "build",
              agent: "build",
              path: { cwd: "/tmp/sql-count", root: "/tmp/sql-count" },
              cost: 0.01,
              tokens: migrationTestTokens(index + 1),
              modelID: "gpt-test",
              providerID: "openai",
              finish: "stop",
              time: { created: now + index, completed: now + index },
            } as any),
          })
          .run()
      }
    })
    AnalyticsStore.prepareBackfill()

    const client = (Database.Client() as any).$client
    const originalPrepare = client.prepare
    let statements = 0
    client.prepare = function (...args: any[]) {
      statements += 1
      return originalPrepare.apply(this, args)
    }
    try {
      await AnalyticsStore.ensureBackfilled()
    } finally {
      client.prepare = originalPrepare
    }

    expect(statements).toBeGreaterThan(0)
    expect(statements).toBeLessThanOrEqual(rowCount * 3 + 11)
    expect(AnalyticsStore.queryResponses().filter((row) => row.session_id === sessionID)).toHaveLength(rowCount)

    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run())
    AnalyticsStore.rebuild()
  })
})
