// OCO-only file: local usage analytics summaries. See oco-dev skill deltas-catalog.md.
import path from "node:path"
import z from "zod"
import { and, eq, gte, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ModelsDev } from "@/provider/models"
import { ProjectTable } from "@/project/project.sql"
import { MessageTable, SessionTable } from "./session.sql"
import { AnalyticsOverrides } from "./analytics-overrides"
import { AnalyticsStore } from "./analytics-store"
import type { MessageV2 } from "./message-v2"

export namespace Analytics {
  export const Period = z.enum(["today", "7d", "30d", "thisMonth", "allTime"])
  export type Period = z.infer<typeof Period>

  export const Query = z.object({
    period: Period.default("30d"),
    /** Project worktree to filter to. When omitted/empty, all projects are included. */
    project: z.string().optional(),
    /** Cross-filter: narrow to a single `provider/model` id. */
    model: z.string().optional(),
    /** Cross-filter: narrow to a single agent id. */
    agent: z.string().optional(),
    /** Cross-filter: narrow to a single ISO day (YYYY-MM-DD). */
    day: z.string().optional(),
    /**
     * Legacy directory-scoped query parameter, kept so older deep-links degrade gracefully.
     * When `project` is also set, `project` wins. The global Analytics page never sends this.
     */
    directory: z.string().optional(),
  })
  export type Query = z.infer<typeof Query>

  export const TokenTotals = z
    .object({
      freshInput: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      total: z.number(),
    })
    .meta({ ref: "AnalyticsTokenTotals" })
  export type TokenTotals = z.infer<typeof TokenTotals>

  export const EstimatedCost = z
    .object({
      amount: z.number(),
      estimated: z.boolean(),
      knownResponses: z.number(),
      unknownResponses: z.number(),
    })
    .meta({ ref: "AnalyticsEstimatedCost" })
  export type EstimatedCost = z.infer<typeof EstimatedCost>

  export const CostBuckets = z
    .object({
      freshInput: EstimatedCost,
      output: EstimatedCost,
      reasoning: EstimatedCost,
      cacheRead: EstimatedCost,
      cacheWrite: EstimatedCost,
      total: EstimatedCost,
    })
    .meta({ ref: "AnalyticsCostBuckets" })
  export type CostBuckets = z.infer<typeof CostBuckets>

  export const Totals = z
    .object({
      actualCost: z.number(),
      apiEquivalentCost: EstimatedCost,
      calls: z.number(),
      sessions: z.number(),
      tokens: TokenTotals,
      apiEquivalentCostBuckets: CostBuckets,
      /**
       * Share of input tokens that were cache reads, in [0, 1].
       * Numerator: cache_read; denominator: fresh_input + cache_read. Returns 0 when both are 0.
       */
      cacheHitRate: z.number(),
    })
    .meta({ ref: "AnalyticsTotals" })
  export type Totals = z.infer<typeof Totals>

  export const TopAttribution = z
    .object({
      id: z.string(),
      label: z.string(),
      tokens: z.number(),
    })
    .meta({ ref: "AnalyticsTopAttribution" })
  export type TopAttribution = z.infer<typeof TopAttribution>

  export const BreakdownRow = z
    .object({
      id: z.string(),
      label: z.string(),
      actualCost: z.number(),
      apiEquivalentCost: EstimatedCost,
      apiEquivalentCostBuckets: CostBuckets,
      calls: z.number(),
      sessions: z.number(),
      tokens: TokenTotals,
      /** Dominant model in this group, by token count, for chart tooltip detail. */
      topModel: TopAttribution.optional(),
      /** Dominant project in this group, by token count, for chart tooltip detail. */
      topProject: TopAttribution.optional(),
      /** Dominant agent in this group, by token count, for chart tooltip detail. */
      topAgent: TopAttribution.optional(),
    })
    .meta({ ref: "AnalyticsBreakdownRow" })
  export type BreakdownRow = z.infer<typeof BreakdownRow>

  export const SessionRow = z
    .object({
      sessionID: z.string(),
      title: z.string(),
      project: z.string(),
      directory: z.string(),
      actualCost: z.number(),
      apiEquivalentCost: EstimatedCost,
      calls: z.number(),
      tokens: TokenTotals,
      lastMessageAt: z.number(),
    })
    .meta({ ref: "AnalyticsSessionRow" })
  export type SessionRow = z.infer<typeof SessionRow>

  export const ResponseRow = z
    .object({
      messageID: z.string(),
      sessionID: z.string(),
      title: z.string(),
      project: z.string(),
      directory: z.string(),
      model: z.string(),
      provider: z.string(),
      agent: z.string(),
      actualCost: z.number(),
      apiEquivalentCost: EstimatedCost,
      tokens: TokenTotals,
      createdAt: z.number(),
    })
    .meta({ ref: "AnalyticsResponseRow" })
  export type ResponseRow = z.infer<typeof ResponseRow>

  export const ProjectOption = z
    .object({
      id: z.string(),
      label: z.string(),
      directory: z.string(),
      calls: z.number(),
    })
    .meta({ ref: "AnalyticsProjectOption" })
  export type ProjectOption = z.infer<typeof ProjectOption>

  export const PricingGap = z
    .object({
      provider: z.string(),
      model: z.string(),
      tokens: z.number(),
      missingApiEquivalent: z.number(),
      calls: z.number(),
      kind: z.enum(["unpriced", "partial"]),
    })
    .meta({ ref: "AnalyticsPricingGap" })
  export type PricingGap = z.infer<typeof PricingGap>

  export const Coverage = z
    .object({
      hasGaps: z.boolean(),
      gaps: PricingGap.array(),
    })
    .meta({ ref: "AnalyticsCoverage" })
  export type Coverage = z.infer<typeof Coverage>

  export const Summary = z
    .object({
      period: Period,
      project: z.string().optional(),
      generatedAt: z.number(),
      range: z.object({ start: z.number().optional(), end: z.number() }),
      totals: Totals,
      breakdowns: z.object({
        byDay: BreakdownRow.array(),
        byProject: BreakdownRow.array(),
        byModel: BreakdownRow.array(),
        byAgent: BreakdownRow.array(),
      }),
      highImpact: z.object({
        sessions: SessionRow.array(),
        responses: ResponseRow.array(),
      }),
      coverage: Coverage,
      availableProjects: ProjectOption.array(),
      /**
       * Present when the summary store is being backfilled. The dashboard should
       * show the backfill progress UI instead of (or alongside) the normal panels.
       */
      backfilling: z
        .object({
          total: z.number(),
          processed: z.number(),
        })
        .optional(),
    })
    .meta({ ref: "AnalyticsSummary" })
  export type Summary = z.infer<typeof Summary>

  export type StandardRates = {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }

  export type RatesLookup = (providerID: string, modelID: string) => StandardRates | undefined

  export type UsageRecord = {
    messageID: string
    sessionID: string
    sessionTitle: string
    directory: string
    projectID: string
    projectWorktree?: string
    projectName?: string
    providerID: string
    modelID: string
    agent: string
    createdAt: number
    actualCost: number
    tokens: TokenTotals
  }

  type CostAccumulator = {
    amount: number
    knownResponses: Set<string>
    unknownResponses: Set<string>
  }

  function emptyTokens(): TokenTotals {
    return { freshInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }

  function addTokens(target: TokenTotals, input: TokenTotals) {
    target.freshInput += input.freshInput
    target.output += input.output
    target.reasoning += input.reasoning
    target.cacheRead += input.cacheRead
    target.cacheWrite += input.cacheWrite
    target.total += input.total
  }

  function emptyCostAccumulator(): CostAccumulator {
    return { amount: 0, knownResponses: new Set(), unknownResponses: new Set() }
  }

  function finishCost(input: CostAccumulator): EstimatedCost {
    return {
      amount: roundCost(input.amount),
      estimated: true,
      knownResponses: input.knownResponses.size,
      unknownResponses: input.unknownResponses.size,
    }
  }

  function emptyCostBuckets(): Record<keyof CostBuckets, CostAccumulator> {
    return {
      freshInput: emptyCostAccumulator(),
      output: emptyCostAccumulator(),
      reasoning: emptyCostAccumulator(),
      cacheRead: emptyCostAccumulator(),
      cacheWrite: emptyCostAccumulator(),
      total: emptyCostAccumulator(),
    }
  }

  function finishBuckets(input: Record<keyof CostBuckets, CostAccumulator>): CostBuckets {
    return {
      freshInput: finishCost(input.freshInput),
      output: finishCost(input.output),
      reasoning: finishCost(input.reasoning),
      cacheRead: finishCost(input.cacheRead),
      cacheWrite: finishCost(input.cacheWrite),
      total: finishCost(input.total),
    }
  }

  function roundCost(value: number) {
    return Math.round(value * 1_000_000) / 1_000_000
  }

  function cost(tokens: number, rate: number) {
    return (tokens * rate) / 1_000_000
  }

  function hasRate(rate: number | undefined): rate is number {
    return rate !== undefined && rate > 0
  }

  function cacheReadCost(record: UsageRecord, rates: StandardRates) {
    if (record.tokens.cacheRead === 0) return 0
    const rate = rates.cacheRead
    if (!hasRate(rate)) return undefined
    return cost(record.tokens.cacheRead, rate)
  }

  function cacheWriteCost(record: Pick<UsageRecord, "providerID" | "tokens">, rates: StandardRates) {
    if (record.tokens.cacheWrite === 0) return 0
    const rate = rates.cacheWrite
    if (!hasRate(rate)) return undefined
    // OpenAI exposes cache write as a separate surcharge; Anthropic's cache-write
    // rate is already the bundled 5-minute input-plus-surcharge creation price.
    if (record.providerID === "openai") return cost(record.tokens.cacheWrite, rates.input + rate)
    return cost(record.tokens.cacheWrite, rate)
  }

  function addCost(bucket: CostAccumulator, messageID: string, amount: number | undefined) {
    if (amount === undefined) {
      bucket.unknownResponses.add(messageID)
      return
    }
    bucket.amount += amount
    bucket.knownResponses.add(messageID)
  }

  function addApiEquivalent(
    buckets: Record<keyof CostBuckets, CostAccumulator>,
    record: UsageRecord,
    rates: StandardRates | undefined,
  ) {
    if (!rates) {
      addCost(buckets.freshInput, record.messageID, undefined)
      addCost(buckets.output, record.messageID, undefined)
      addCost(buckets.reasoning, record.messageID, undefined)
      addCost(buckets.cacheRead, record.messageID, undefined)
      addCost(buckets.cacheWrite, record.messageID, undefined)
      addCost(buckets.total, record.messageID, undefined)
      return
    }

    const freshInput = cost(record.tokens.freshInput, rates.input)
    const output = cost(record.tokens.output, rates.output)
    const reasoning = cost(record.tokens.reasoning, rates.output)
    const cacheRead = cacheReadCost(record, rates)
    const cacheWrite = cacheWriteCost(record, rates)
    const total = cacheRead === undefined || cacheWrite === undefined ? undefined : freshInput + output + reasoning + cacheRead + cacheWrite

    addCost(buckets.freshInput, record.messageID, freshInput)
    addCost(buckets.output, record.messageID, output)
    addCost(buckets.reasoning, record.messageID, reasoning)
    addCost(buckets.cacheRead, record.messageID, cacheRead)
    addCost(buckets.cacheWrite, record.messageID, cacheWrite)
    addCost(buckets.total, record.messageID, total)
  }

  function projectKey(record: Pick<UsageRecord, "projectWorktree" | "directory" | "projectID">) {
    if (record.projectWorktree && record.projectID !== "global") return record.projectWorktree
    return record.directory
  }

  function projectLabel(record: Pick<UsageRecord, "projectName" | "projectWorktree" | "directory" | "projectID">) {
    if (record.projectName) return record.projectName
    const source = record.projectWorktree && record.projectID !== "global" ? record.projectWorktree : record.directory
    return path.basename(source) || source || "Unknown project"
  }

  function dayLabel(timestamp: number) {
    return new Date(timestamp).toISOString().slice(0, 10)
  }

  function periodStart(period: Period, now: number) {
    const date = new Date(now)
    if (period === "allTime") return undefined
    if (period === "today") {
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    if (period === "thisMonth") {
      date.setDate(1)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    const days = period === "7d" ? 7 : 30
    return now - days * 24 * 60 * 60 * 1000
  }

  function cacheHitRate(tokens: TokenTotals): number {
    const denom = tokens.freshInput + tokens.cacheRead
    if (denom <= 0) return 0
    return tokens.cacheRead / denom
  }

  function summarizeCost(records: UsageRecord[], lookup: RatesLookup) {
    const buckets = emptyCostBuckets()
    for (const record of records) addApiEquivalent(buckets, record, lookup(record.providerID, record.modelID))
    return finishBuckets(buckets)
  }

  function summarizeTotals(records: UsageRecord[], lookup: RatesLookup): Totals {
    const tokens = emptyTokens()
    const sessions = new Set<string>()
    let actualCost = 0
    for (const record of records) {
      addTokens(tokens, record.tokens)
      actualCost += record.actualCost
      sessions.add(record.sessionID)
    }
    const apiEquivalentCostBuckets = summarizeCost(records, lookup)
    return {
      actualCost: roundCost(actualCost),
      apiEquivalentCost: apiEquivalentCostBuckets.total,
      calls: records.length,
      sessions: sessions.size,
      tokens,
      apiEquivalentCostBuckets,
      cacheHitRate: cacheHitRate(tokens),
    }
  }

  function topByTokens(
    records: UsageRecord[],
    key: (record: UsageRecord) => { id: string; label: string },
  ): TopAttribution | undefined {
    const map = new Map<string, { label: string; tokens: number }>()
    for (const record of records) {
      const k = key(record)
      const prior = map.get(k.id) ?? { label: k.label, tokens: 0 }
      prior.tokens += record.tokens.total
      map.set(k.id, prior)
    }
    let bestId: string | undefined
    let bestTokens = -1
    let bestLabel = ""
    for (const [id, entry] of map.entries()) {
      if (entry.tokens > bestTokens) {
        bestId = id
        bestTokens = entry.tokens
        bestLabel = entry.label
      }
    }
    if (bestId === undefined || bestTokens <= 0) return undefined
    return { id: bestId, label: bestLabel, tokens: bestTokens }
  }

  function breakdown(
    records: UsageRecord[],
    key: (record: UsageRecord) => { id: string; label: string },
    lookup: RatesLookup,
    limit?: number,
  ): BreakdownRow[] {
    const groups = new Map<string, { id: string; label: string; records: UsageRecord[] }>()
    for (const record of records) {
      const item = key(record)
      const group = groups.get(item.id) ?? { ...item, records: [] }
      group.records.push(record)
      groups.set(item.id, group)
    }
    const rows = Array.from(groups.values())
      .map((group) => {
        const totals = summarizeTotals(group.records, lookup)
        const topModel = topByTokens(group.records, (r) => ({
          id: `${r.providerID}/${r.modelID}`,
          label: `${r.providerID}/${r.modelID}`,
        }))
        const topProject = topByTokens(group.records, (r) => ({
          id: projectKey(r),
          label: projectLabel(r),
        }))
        const topAgent = topByTokens(group.records, (r) => ({
          id: r.agent || "unknown",
          label: r.agent || "Unknown",
        }))
        return { id: group.id, label: group.label, ...totals, topModel, topProject, topAgent }
      })
      .sort((a, b) => b.apiEquivalentCost.amount - a.apiEquivalentCost.amount || b.actualCost - a.actualCost)
    return limit === undefined ? rows : rows.slice(0, limit)
  }

  function highImpactSessions(records: UsageRecord[], lookup: RatesLookup) {
    const groups = new Map<string, UsageRecord[]>()
    for (const record of records) groups.set(record.sessionID, [...(groups.get(record.sessionID) ?? []), record])
    return Array.from(groups.values())
      .map((items) => {
        const [first] = items
        const totals = summarizeTotals(items, lookup)
        return {
          sessionID: first.sessionID,
          title: first.sessionTitle,
          project: projectLabel(first),
          directory: first.directory,
          actualCost: totals.actualCost,
          apiEquivalentCost: totals.apiEquivalentCost,
          calls: totals.calls,
          tokens: totals.tokens,
          lastMessageAt: Math.max(...items.map((item) => item.createdAt)),
        }
      })
      .sort((a, b) => b.apiEquivalentCost.amount - a.apiEquivalentCost.amount || b.actualCost - a.actualCost)
      .slice(0, 10)
  }

  function highImpactResponses(records: UsageRecord[], lookup: RatesLookup) {
    return records
      .map((record) => {
        const totals = summarizeTotals([record], lookup)
        return {
          messageID: record.messageID,
          sessionID: record.sessionID,
          title: record.sessionTitle,
          project: projectLabel(record),
          directory: record.directory,
          model: record.modelID,
          provider: record.providerID,
          agent: record.agent,
          actualCost: totals.actualCost,
          apiEquivalentCost: totals.apiEquivalentCost,
          tokens: totals.tokens,
          createdAt: record.createdAt,
        }
      })
      .sort((a, b) => b.apiEquivalentCost.amount - a.apiEquivalentCost.amount || b.actualCost - a.actualCost)
      .slice(0, 20)
  }

  /**
   * Inspect every record in scope and detect models with no or partial standard pricing.
   *
   * - "unpriced": the lookup returns undefined for every call to that provider/model pair.
   * - "partial": the lookup returns rates but at least one billed token type has a zero rate
   *   that the recorded usage actually consumed (e.g. the catalog has no cache_read rate
   *   but the model returned cache reads). Output and input rates of zero are *only* a
   *   partial signal when the corresponding bucket has nonzero usage.
   *
   * `missingApiEquivalent` is reported as the recorded `actualCost` for unpriced gaps
   * (the provider-billed cost is the best honest proxy for "what API-equivalent we could
   * not compute"). For partial gaps it is `max(actualCost - apiEquivalentCovered, 0)` so
   * it reflects only the share that the rates we *do* have could not account for.
   */
  function detectGaps(records: UsageRecord[], lookup: RatesLookup): Coverage {
    type Acc = {
      provider: string
      model: string
      tokens: number
      calls: number
      missing: number
      kind: "unpriced" | "partial"
    }
    const acc = new Map<string, Acc>()
    for (const record of records) {
      const key = `${record.providerID}/${record.modelID}`
      const rates = lookup(record.providerID, record.modelID)
      if (!rates) {
        const prior =
          acc.get(key) ?? {
            provider: record.providerID,
            model: record.modelID,
            tokens: 0,
            calls: 0,
            missing: 0,
            kind: "unpriced" as const,
          }
        prior.tokens += record.tokens.total
        prior.calls += 1
        prior.missing += record.actualCost
        prior.kind = "unpriced"
        acc.set(key, prior)
        continue
      }
      // Detect partial gaps: a zero rate combined with nonzero usage in that bucket.
      const hasPartial =
        (record.tokens.cacheRead > 0 && !hasRate(rates.cacheRead)) ||
        (record.tokens.cacheWrite > 0 && !hasRate(rates.cacheWrite)) ||
        (record.tokens.freshInput > 0 && rates.input === 0) ||
        ((record.tokens.output > 0 || record.tokens.reasoning > 0) && rates.output === 0)
      if (!hasPartial) continue
      // What this record contributed in API-equivalent value with the rates we have.
      const covered =
        cost(record.tokens.freshInput, rates.input) +
        cost(record.tokens.output, rates.output) +
        cost(record.tokens.reasoning, rates.output) +
        (cacheReadCost(record, rates) ?? 0) +
        (cacheWriteCost(record, rates) ?? 0)
      const missingForRecord = Math.max(record.actualCost - covered, 0)
      const prior =
        acc.get(key) ?? {
          provider: record.providerID,
          model: record.modelID,
          tokens: 0,
          calls: 0,
          missing: 0,
          kind: "partial" as const,
        }
      prior.tokens += record.tokens.total
      prior.calls += 1
      prior.missing += missingForRecord
      // Only escalate to "partial"; never downgrade an existing "unpriced".
      if (prior.kind !== "unpriced") prior.kind = "partial"
      acc.set(key, prior)
    }
    const gaps = Array.from(acc.values())
      .map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        tokens: entry.tokens,
        calls: entry.calls,
        missingApiEquivalent: roundCost(entry.missing),
        kind: entry.kind,
      }))
      .sort((a, b) => b.tokens - a.tokens)
    return { hasGaps: gaps.length > 0, gaps }
  }

  function availableProjects(records: UsageRecord[]): ProjectOption[] {
    const map = new Map<string, ProjectOption>()
    for (const record of records) {
      const id = projectKey(record)
      const prior = map.get(id) ?? {
        id,
        label: projectLabel(record),
        directory: record.directory,
        calls: 0,
      }
      prior.calls += 1
      map.set(id, prior)
    }
    return Array.from(map.values()).sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label))
  }

  function inProjectFilter(record: UsageRecord, project?: string) {
    if (!project) return true
    if (record.projectWorktree === project) return true
    if (record.directory === project) return true
    return false
  }

  function inModelFilter(record: UsageRecord, model?: string) {
    if (!model) return true
    return `${record.providerID}/${record.modelID}` === model
  }

  function inAgentFilter(record: UsageRecord, agent?: string) {
    if (!agent) return true
    return (record.agent || "unknown") === agent
  }

  function inDayFilter(record: UsageRecord, day?: string) {
    if (!day) return true
    return dayLabel(record.createdAt) === day
  }

  type ResolvedFilters = { project?: string; model?: string; agent?: string; day?: string }

  /**
   * Apply all filters EXCEPT the one named in `exclude`. Used so a breakdown panel
   * (e.g. byModel) can still show all models when the user has cross-filtered to a single
   * model — they need to be able to pick a different model without first clearing the chip.
   */
  function applyFilters(records: UsageRecord[], filters: ResolvedFilters, exclude?: keyof ResolvedFilters) {
    return records.filter((record) => {
      if (exclude !== "project" && !inProjectFilter(record, filters.project)) return false
      if (exclude !== "model" && !inModelFilter(record, filters.model)) return false
      if (exclude !== "agent" && !inAgentFilter(record, filters.agent)) return false
      if (exclude !== "day" && !inDayFilter(record, filters.day)) return false
      return true
    })
  }

  export function summarizeRecords(
    /** Records that are already filtered to the requested period. The "all projects" set. */
    records: UsageRecord[],
    query: Query,
    lookup: RatesLookup,
    now = Date.now(),
  ): Summary {
    const start = periodStart(query.period, now)
    // `availableProjects` is the cross-project list — the one that powers the filter dropdown.
    // It must always reflect every project with usage in the period regardless of the active filter.
    const available = availableProjects(records)

    const filters: ResolvedFilters = {
      project: query.project || query.directory,
      model: query.model,
      agent: query.agent,
      day: query.day,
    }

    // The "narrowed" set has every active filter applied. This is what KPIs and the
    // pricing-coverage surface and high-impact lists run against.
    const narrowed = applyFilters(records, filters)
    const totals = summarizeTotals(narrowed, lookup)

    return {
      period: query.period,
      project: filters.project,
      generatedAt: now,
      range: { start, end: now },
      totals,
      breakdowns: {
        byDay: breakdown(applyFilters(records, filters, "day"), (record) => ({ id: dayLabel(record.createdAt), label: dayLabel(record.createdAt) }), lookup),
        byProject: breakdown(applyFilters(records, filters, "project"), (record) => ({ id: projectKey(record), label: projectLabel(record) }), lookup),
        byModel: breakdown(
          applyFilters(records, filters, "model"),
          (record) => ({ id: `${record.providerID}/${record.modelID}`, label: `${record.providerID}/${record.modelID}` }),
          lookup,
        ),
        byAgent: breakdown(applyFilters(records, filters, "agent"), (record) => ({ id: record.agent || "unknown", label: record.agent || "Unknown" }), lookup),
      },
      highImpact: {
        sessions: highImpactSessions(narrowed, lookup),
        responses: highImpactResponses(narrowed, lookup),
      },
      coverage: detectGaps(narrowed, lookup),
      availableProjects: available,
    }
  }

  /**
   * Combined lookup: pricing override layer first, then upstream models.dev catalog.
   *
   * The override layer can:
   *   1. Provide direct rates for a (provider, model) pair (highest priority).
   *   2. Alias a (provider, model) pair to another (provider, model) pair, which is then
   *      resolved against models.dev. The alias chain is followed once to avoid loops.
   */
  export function buildLookup(data: Record<string, ModelsDev.Provider>, overrides: AnalyticsOverrides.Resolved): RatesLookup {
    const fromCatalog = (providerID: string, modelID: string): StandardRates | undefined => {
      const provider = data[providerID]
      const model = provider?.models[modelID]
      const standard = model?.cost
      if (!standard) return undefined
      return {
        input: standard.input,
        output: standard.output,
        ...(standard.cache_read !== undefined ? { cacheRead: standard.cache_read } : {}),
        ...(standard.cache_write !== undefined ? { cacheWrite: standard.cache_write } : {}),
      }
    }
    return (providerID, modelID) => {
      const direct = AnalyticsOverrides.lookup(overrides, providerID, modelID)
      if (direct?.kind === "rates") return direct.rates
      if (direct?.kind === "alias") {
        // Resolve the alias target. If the target is itself an override rate, use it.
        const target = direct.target
        const aliasRates = AnalyticsOverrides.lookup(overrides, target.provider, target.model)
        if (aliasRates?.kind === "rates") return aliasRates.rates
        // Otherwise fall back to the catalog under the alias target.
        return fromCatalog(target.provider, target.model)
      }
      return fromCatalog(providerID, modelID)
    }
  }

  function toRecord(row: {
    message: typeof MessageTable.$inferSelect
    session: typeof SessionTable.$inferSelect
    project: typeof ProjectTable.$inferSelect | null
  }): UsageRecord | undefined {
    const data = row.message.data as MessageV2.Info
    if (data.role !== "assistant") return undefined
    return {
      messageID: row.message.id,
      sessionID: row.session.id,
      sessionTitle: row.session.title,
      directory: row.session.directory,
      projectID: row.session.project_id,
      projectWorktree: row.project?.worktree ?? undefined,
      projectName: row.project?.name || undefined,
      providerID: data.providerID,
      modelID: data.modelID,
      agent: data.agent,
      createdAt: data.time.completed ?? data.time.created ?? row.message.time_created,
      actualCost: data.cost,
      tokens: {
        freshInput: data.tokens.input,
        output: data.tokens.output,
        reasoning: data.tokens.reasoning,
        cacheRead: data.tokens.cache.read,
        cacheWrite: data.tokens.cache.write,
        total:
          data.tokens.input +
          data.tokens.output +
          data.tokens.reasoning +
          data.tokens.cache.read +
          data.tokens.cache.write,
      },
    }
  }

  /**
   * Read assistant rows from SQLite. The period filter is pushed into SQL so we don't
   * scan the full message table for short windows. Project filtering happens in JS so
   * the same row set still drives the cross-project breakdown shown in the UI.
   */
  async function records(period: Period, now: number) {
    const start = periodStart(period, now)
    return Database.use((db) => {
      const where = start === undefined
        ? sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`
        : and(
            sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
            gte(MessageTable.time_created, start),
          )
      return db
        .select({ message: MessageTable, session: SessionTable, project: ProjectTable })
        .from(MessageTable)
        .innerJoin(SessionTable, eq(MessageTable.session_id, SessionTable.id))
        .leftJoin(ProjectTable, eq(SessionTable.project_id, ProjectTable.id))
        .where(where)
        .all()
    })
      .map(toRecord)
      .filter((record): record is UsageRecord => record !== undefined)
  }

  /**
   * Main entry point. Uses the persistent summary store for fast reads after backfill.
   * Falls back to a "backfilling" status when the store is empty or still being built.
   */
  export async function summary(query: Query, now = Date.now()) {
    const [data, overrides] = await Promise.all([ModelsDev.get(), AnalyticsOverrides.loadResolved()])
    const lookup = buildLookup(data, overrides)

    // Check store status.
    const storeState = AnalyticsStore.storeStatus()
    if (storeState === "empty") {
      // Trigger backfill asynchronously and return "backfilling" immediately.
      const progress = AnalyticsStore.prepareBackfill()
      if (progress.total === 0) return summaryFromStore(query, lookup, now)
      AnalyticsStore.ensureBackfilled().catch(() => {})
      return buildBackfillingResponse(query, now, progress)
    }

    if (storeState === "backfilling") {
      // Backfill may be running or may have been interrupted by a previous quit.
      if (!AnalyticsStore.isBackfilling()) AnalyticsStore.ensureBackfilled().catch(() => {})
      const progress = AnalyticsStore.progress() ?? { total: 0, processed: 0 }
      return buildBackfillingResponse(query, now, progress)
    }

    // Store is ready — fold in any new messages since last aggregation, then read.
    await AnalyticsStore.foldIncremental()
    return summaryFromStore(query, lookup, now)
  }

  /**
   * Trigger a rebuild: clears the summary store and starts a fresh backfill.
   * Returns a "backfilling" response.
   */
  export async function rebuildSummary(query: Query, now = Date.now()) {
    AnalyticsStore.rebuild()
    AnalyticsStore.ensureBackfilled().catch(() => {})
    const progress = AnalyticsStore.progress() ?? { total: 0, processed: 0 }
    return buildBackfillingResponse(query, now, progress)
  }

  /**
   * Build a "backfilling" Summary response with empty data but with the
   * `backfilling` field set.
   */
  function buildBackfillingResponse(query: Query, now: number, progress: { total: number; processed: number }): Summary {
    const start = periodStart(query.period, now)
    return {
      period: query.period,
      project: query.project,
      generatedAt: now,
      range: { start, end: now },
      totals: {
        actualCost: 0,
        apiEquivalentCost: { amount: 0, estimated: true, knownResponses: 0, unknownResponses: 0 },
        calls: 0,
        sessions: 0,
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
      breakdowns: { byDay: [], byProject: [], byModel: [], byAgent: [] },
      highImpact: { sessions: [], responses: [] },
      coverage: { hasGaps: false, gaps: [] },
      availableProjects: [],
      backfilling: progress,
    }
  }

  /**
   * Build a Summary from the persistent summary store. This is the steady-state path.
   *
   * Daily rows provide per-(day, provider, model, agent, project_key) aggregates.
   * Session rows provide per-session aggregates for high-impact lists.
   * Response rows provide per-message aggregates for high-impact response lists.
   *
   * All filtering (project, model, agent, day) happens in JS over the store rows,
   * matching V2's approach. API-equivalent dollars are computed at read time from
   * the pricing lookup.
   */
  function summaryFromStore(query: Query, lookup: RatesLookup, now: number): Summary {
    const start = periodStart(query.period, now)
    const records = AnalyticsStore.queryResponses(start).map(responseAggToUsageRecord)
    return summarizeRecords(records, query, lookup, now)
  }

  function toDayString(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10)
  }

  /** Convert a store daily row to a UsageRecord for reuse of existing breakdown/totals logic. */
  function dailyToRecord(row: AnalyticsStore.DailyRow): UsageRecord {
    return {
      messageID: `daily:${row.day}:${row.provider}:${row.model}:${row.agent}:${row.project_key}`,
      sessionID: `daily:${row.day}:${row.provider}:${row.model}:${row.agent}:${row.project_key}`,
      sessionTitle: "",
      directory: row.directory,
      projectID: "",
      projectWorktree: row.project_key,
      projectName: row.project_label || undefined,
      providerID: row.provider,
      modelID: row.model,
      agent: row.agent,
      createdAt: new Date(row.day).getTime(),
      actualCost: row.actual_cost,
      tokens: {
        freshInput: row.fresh_input,
        output: row.output,
        reasoning: row.reasoning,
        cacheRead: row.cache_read,
        cacheWrite: row.cache_write,
        total: row.fresh_input + row.output + row.reasoning + row.cache_read + row.cache_write,
      },
    }
  }

  function responseAggToUsageRecord(row: AnalyticsStore.ResponseRow): UsageRecord {
    return {
      messageID: row.message_id,
      sessionID: row.session_id,
      sessionTitle: row.title,
      directory: row.directory,
      projectID: "",
      projectWorktree: row.project_key,
      projectName: row.project_label || undefined,
      providerID: row.provider,
      modelID: row.model,
      agent: row.agent,
      createdAt: row.created_at,
      actualCost: row.actual_cost,
      tokens: {
        freshInput: row.fresh_input,
        output: row.output,
        reasoning: row.reasoning,
        cacheRead: row.cache_read,
        cacheWrite: row.cache_write,
        total: row.fresh_input + row.output + row.reasoning + row.cache_read + row.cache_write,
      },
    }
  }

  /** Convert a store session aggregate to a SessionRow for the high-impact list. */
  function sessionAggToSessionRow(row: AnalyticsStore.SessionAgg, lookup: RatesLookup): SessionRow {
    const tokens: TokenTotals = {
      freshInput: row.fresh_input,
      output: row.output,
      reasoning: row.reasoning,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      total: row.fresh_input + row.output + row.reasoning + row.cache_read + row.cache_write,
    }
    const rates = lookup(row.provider, row.model)
    const apiEquiv = rates ? computeApiEquiv(row.provider, tokens, rates, row.calls) : {
      amount: 0,
      estimated: true,
      knownResponses: 0,
      unknownResponses: row.calls,
    }
    return {
      sessionID: row.session_id,
      title: row.title,
      project: row.project_label,
      directory: row.directory,
      actualCost: roundCost(row.actual_cost),
      apiEquivalentCost: apiEquiv,
      calls: row.calls,
      tokens,
      lastMessageAt: row.last_message_at,
    }
  }

  /** Convert a store response aggregate to a ResponseRow for the high-impact list. */
  function responseAggToResponseRow(row: AnalyticsStore.ResponseRow, lookup: RatesLookup): ResponseRow {
    const tokens: TokenTotals = {
      freshInput: row.fresh_input,
      output: row.output,
      reasoning: row.reasoning,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      total: row.fresh_input + row.output + row.reasoning + row.cache_read + row.cache_write,
    }
    const rates = lookup(row.provider, row.model)
    const apiEquiv = rates ? computeApiEquiv(row.provider, tokens, rates) : {
      amount: 0,
      estimated: true,
      knownResponses: 0,
      unknownResponses: 1,
    }
    return {
      messageID: row.message_id,
      sessionID: row.session_id,
      title: row.title,
      project: row.project_label,
      directory: row.directory,
      model: row.model,
      provider: row.provider,
      agent: row.agent,
      actualCost: roundCost(row.actual_cost),
      apiEquivalentCost: apiEquiv,
      tokens,
      createdAt: row.created_at,
    }
  }

  /** Compute API-equivalent cost from tokens and rates (computed at read time, never persisted). */
  function computeApiEquiv(providerID: string, tokens: TokenTotals, rates: StandardRates, calls = 1): EstimatedCost {
    const freshInput = cost(tokens.freshInput, rates.input)
    const output = cost(tokens.output, rates.output)
    const reasoning = cost(tokens.reasoning, rates.output)
    const cacheRead = tokens.cacheRead === 0 || hasRate(rates.cacheRead) ? cost(tokens.cacheRead, rates.cacheRead ?? 0) : undefined
    const cacheWrite = cacheWriteCost({ providerID, tokens }, rates)
    const total = cacheRead === undefined || cacheWrite === undefined ? undefined : freshInput + output + reasoning + cacheRead + cacheWrite
    return {
      amount: roundCost(total ?? freshInput + output + reasoning + (cacheRead ?? 0) + (cacheWrite ?? 0)),
      estimated: true,
      knownResponses: total === undefined ? 0 : calls,
      unknownResponses: total === undefined ? calls : 0,
    }
  }
}
