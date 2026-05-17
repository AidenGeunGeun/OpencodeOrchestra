import { sql, eq, gt, gte, lte, and, or, inArray, type SQL } from "drizzle-orm"
import { Database } from "@/storage/db"
import {
  AnalyticsDailyTable,
  AnalyticsSessionTable,
  AnalyticsResponseTable,
  AnalyticsSkippedResponseTable,
  AnalyticsWatermarkTable,
} from "./analytics-summary.sql"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import { ProjectTable } from "@/project/project.sql"
import type { MessageV2 } from "./message-v2"
import path from "node:path"
import { Log } from "../util/log"

const log = Log.create({ service: "analytics.store" })

const BACKFILL_CHUNK_SIZE = 250
const BACKFILL_YIELD_INTERVAL_MS = 16 // ~1 frame at 60fps — keeps UI responsive
const STALE_UNFINISHED_WINDOW_MS = 60 * 60 * 1000

export namespace AnalyticsStore {
  export type Progress = { total: number; processed: number }
  export type Status = "empty" | "backfilling" | "ready"

  export type DailyRow = typeof AnalyticsDailyTable.$inferSelect
  export type SessionAgg = typeof AnalyticsSessionTable.$inferSelect
  export type ResponseRow = typeof AnalyticsResponseTable.$inferSelect
  export type Watermark = typeof AnalyticsWatermarkTable.$inferSelect

  // ---------------------------------------------------------------------------
  // Watermark
  // ---------------------------------------------------------------------------

  export function readWatermark(): Watermark | undefined {
    return Database.use((db) =>
      db.select().from(AnalyticsWatermarkTable).where(eq(AnalyticsWatermarkTable.id, 1)).get(),
    )
  }

  export function storeStatus(): Status {
    const wm = readWatermark()
    if (!wm || wm.total_messages === 0) return "empty"
    if (wm.processed_messages < wm.total_messages) return hasPendingRowAfterWatermark(wm) ? "backfilling" : "ready"
    return "ready"
  }

  function hasPendingRowAfterWatermark(wm: Watermark): boolean {
    return Database.use((db) => {
      const row = db
        .select({ id: MessageTable.id })
        .from(MessageTable)
        .where(
          and(
            sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
            or(
              gt(MessageTable.time_created, wm.last_time_created),
              and(eq(MessageTable.time_created, wm.last_time_created), gt(MessageTable.id, wm.last_message_id)),
            ),
          ),
        )
        .orderBy(MessageTable.time_created, MessageTable.id)
        .limit(1)
        .get()
      return row !== undefined
    })
  }

  export function progress(): Progress | undefined {
    const wm = readWatermark()
    if (!wm || wm.total_messages === 0) return undefined
    return { total: wm.total_messages, processed: wm.processed_messages }
  }

  /** Seed the watermark with an accurate total count so the first UI response can show progress. */
  export function prepareBackfill(): Progress {
    const total = countAssistantMessages()
    seedOrRefreshWatermarkTotal(total)
    return { total, processed: readWatermark()?.processed_messages ?? 0 }
  }

  function seedOrRefreshWatermarkTotal(total = countAssistantMessages()): void {
    Database.use((db) => {
      const existing = db
        .select()
        .from(AnalyticsWatermarkTable)
        .where(eq(AnalyticsWatermarkTable.id, 1))
        .get()
      if (!existing) {
        db.insert(AnalyticsWatermarkTable)
          .values({
            id: 1,
            last_time_created: 0,
            last_message_id: "",
            total_messages: total,
            processed_messages: 0,
            updated_at: Date.now(),
          })
          .run()
      } else if (existing.total_messages < total) {
        db.update(AnalyticsWatermarkTable)
          .set({ total_messages: total, updated_at: Date.now() })
          .where(eq(AnalyticsWatermarkTable.id, 1))
          .run()
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Backfill (chunked, resumable, non-blocking)
  // ---------------------------------------------------------------------------

  let backfillRunning = false

  export function isBackfilling(): boolean {
    return backfillRunning
  }

  /**
   * Start or resume backfill. Idempotent — if already running, waits for it.
   * Processes messages in timestamp order in chunks, yielding to the event loop
   * between chunks so the app stays responsive (C4).
   */
  export async function ensureBackfilled(): Promise<void> {
    if (backfillRunning) {
      while (backfillRunning) await new Promise((r) => setTimeout(r, 200))
      return
    }
    backfillRunning = true
    try {
      await runBackfill()
    } catch (err) {
      log.error("backfill failed", { error: (err as Error).message })
    } finally {
      backfillRunning = false
    }
  }

  async function runBackfill(): Promise<void> {
    // Count total assistant messages.
    const total = countAssistantMessages()

    // Seed watermark if missing.
    seedOrRefreshWatermarkTotal(total)

    if (total === 0) return

    let lastYield = Date.now()
    while (true) {
      const wm = readWatermark()
      if (!wm) break

      const processed = processChunk(wm.last_time_created, wm.last_message_id)
      if (processed === 0) break

      // Yield to event loop periodically so other work stays responsive.
      if (Date.now() - lastYield > BACKFILL_YIELD_INTERVAL_MS) {
        await new Promise((r) => setImmediate(r))
        lastYield = Date.now()
      }
    }

    // Completion is represented by processed_messages reaching total_messages via
    // real folds. Do not force-complete here: the next row may be a streamed
    // placeholder that must remain behind the watermark until it finishes.
  }

  /**
   * Process one chunk of messages. Reads messages with time_created > afterTime,
   * writes aggregates, advances watermark. Returns number of messages processed.
   * Everything happens in one Database.use call (synchronous, single-threaded).
   */
  function processChunk(afterTime: number, afterID: string): number {
    return Database.transaction((db) => {
      const rows = db
        .select({ message: MessageTable, session: SessionTable, project: ProjectTable })
        .from(MessageTable)
        .innerJoin(SessionTable, eq(MessageTable.session_id, SessionTable.id))
        .leftJoin(ProjectTable, eq(SessionTable.project_id, ProjectTable.id))
        .where(
          and(
            sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
            or(
              gt(MessageTable.time_created, afterTime),
              and(eq(MessageTable.time_created, afterTime), gt(MessageTable.id, afterID)),
            ),
          ),
        )
        .orderBy(MessageTable.time_created, MessageTable.id)
        .limit(BACKFILL_CHUNK_SIZE)
        .all()

      if (rows.length === 0) return 0
      const stepUsage = providerStepUsageByMessage(db, rows.map((row) => row.message.id))

      let maxTimeCreated = afterTime
      let maxMessageID = afterID
      let processed = 0

      for (const row of rows) {
        const record = toStorageRecord(row, stepUsage.get(row.message.id))
        if (!record) break
        if (record.kind === "fold") {
          upsertDaily(db, record)
          upsertSession(db, record)
          upsertResponse(db, record)
        } else {
          upsertSkipped(db, record)
        }
        processed += 1
        if (record.watermarkTime > maxTimeCreated || (record.watermarkTime === maxTimeCreated && record.messageID > maxMessageID)) {
          maxTimeCreated = record.watermarkTime
          maxMessageID = record.messageID
        }
      }

      if (processed === 0) return 0

      // Advance watermark only over rows that were actually folded. Incomplete streamed
      // assistant placeholders must stay visible to a later fold after completion.
      db.update(AnalyticsWatermarkTable)
        .set({
          last_time_created: maxTimeCreated,
          last_message_id: maxMessageID,
          processed_messages: sql`${AnalyticsWatermarkTable.processed_messages} + ${processed}`,
          updated_at: Date.now(),
        })
        .where(eq(AnalyticsWatermarkTable.id, 1))
        .run()

      return processed
    })
  }

  function countAssistantMessages(): number {
    return Database.use((db) => {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(MessageTable)
        .where(sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`)
        .get()
      return row?.count ?? 0
    })
  }

  // ---------------------------------------------------------------------------
  // Incremental fold-in
  // ---------------------------------------------------------------------------

  /**
   * Fold any new assistant messages (newer than the watermark) into the summary store.
   * Should be called before reading from the store to capture messages written since
   * the last Analytics request.
   */
  export async function foldIncremental(): Promise<number> {
    const wm = readWatermark()
    if (!wm) return 0
    seedOrRefreshWatermarkTotal()
    let total = 0
    let lastYield = Date.now()
    while (true) {
      const current = readWatermark()
      if (!current) break
      const processed = processChunk(current.last_time_created, current.last_message_id)
      if (processed === 0) break
      total += processed
      if (Date.now() - lastYield > BACKFILL_YIELD_INTERVAL_MS) {
        await new Promise((r) => setImmediate(r))
        lastYield = Date.now()
      }
    }
    return total
  }

  // ---------------------------------------------------------------------------
  // Read from summary store
  // ---------------------------------------------------------------------------

  /**
   * Read daily aggregate rows for a given day range. Both bounds are inclusive.
   * Days are ISO strings (YYYY-MM-DD).
   */
  export function queryDaily(startDay?: string, endDay?: string): DailyRow[] {
    const conditions: SQL[] = []
    if (startDay) conditions.push(gte(AnalyticsDailyTable.day, startDay))
    if (endDay) conditions.push(lte(AnalyticsDailyTable.day, endDay))

    return Database.use((db) => {
      if (conditions.length > 0) {
        return db
          .select()
          .from(AnalyticsDailyTable)
          .where(and(...conditions))
          .all()
      }
      return db.select().from(AnalyticsDailyTable).all()
    })
  }

  /** Read the N highest-cost sessions for high-impact list. */
  export function queryHighImpactSessions(limit = 10, since?: number): SessionAgg[] {
    return Database.use((db) =>
      since === undefined
        ? db
            .select()
            .from(AnalyticsSessionTable)
            .orderBy(sql`${AnalyticsSessionTable.actual_cost} DESC`)
            .limit(limit)
            .all()
        : db
            .select()
            .from(AnalyticsSessionTable)
            .where(gte(AnalyticsSessionTable.last_message_at, since))
            .orderBy(sql`${AnalyticsSessionTable.actual_cost} DESC`)
            .limit(limit)
            .all(),
    )
  }

  /** Read the N highest-cost responses for high-impact list. */
  export function queryHighImpactResponses(limit = 20, since?: number): ResponseRow[] {
    return Database.use((db) =>
      since === undefined
        ? db
            .select()
            .from(AnalyticsResponseTable)
            .orderBy(sql`${AnalyticsResponseTable.actual_cost} DESC`)
            .limit(limit)
            .all()
        : db
            .select()
            .from(AnalyticsResponseTable)
            .where(gte(AnalyticsResponseTable.created_at, since))
            .orderBy(sql`${AnalyticsResponseTable.actual_cost} DESC`)
            .limit(limit)
            .all(),
    )
  }

  /** Read compact response-level summary rows for the selected period. */
  export function queryResponses(since?: number): ResponseRow[] {
    return Database.use((db) =>
      since === undefined
        ? db.select().from(AnalyticsResponseTable).all()
        : db.select().from(AnalyticsResponseTable).where(gte(AnalyticsResponseTable.created_at, since)).all(),
    )
  }

  // ---------------------------------------------------------------------------
  // Rebuild
  // ---------------------------------------------------------------------------

  /** Clear all summary tables and watermark, forcing a fresh backfill on next request. */
  export function rebuild(): void {
    Database.transaction((db) => {
      db.delete(AnalyticsDailyTable).run()
      db.delete(AnalyticsSessionTable).run()
      db.delete(AnalyticsResponseTable).run()
      db.delete(AnalyticsSkippedResponseTable).run()
      db.delete(AnalyticsWatermarkTable).run()
    })
    log.info("summary store cleared for rebuild")
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  interface StorageRecord {
    kind: "fold"
    messageID: string
    sessionID: string
    sessionTitle: string
    directory: string
    projectKey: string
    projectLabel: string
    provider: string
    model: string
    agent: string
    time_created: number
    watermarkTime: number
    actualCost: number
    calls: number
    tokens: {
      freshInput: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }

  interface SkippedRecord {
    kind: "skip"
    messageID: string
    sessionID: string
    watermarkTime: number
    reason: string
    sourceCreatedAt: number
    cutoffAt: number
  }

  type ProcessRecord = StorageRecord | SkippedRecord

  function toDayString(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10)
  }

  function computeProjectKey(opts: { projectWorktree?: string; projectID: string; directory: string }): string {
    if (opts.projectWorktree && opts.projectID !== "global") return opts.projectWorktree
    return opts.directory
  }

  function computeProjectLabel(opts: {
    projectName?: string
    projectWorktree?: string
    projectID: string
    directory: string
  }): string {
    if (opts.projectName) return opts.projectName
    const source =
      opts.projectWorktree && opts.projectID !== "global" ? opts.projectWorktree : opts.directory
    return path.basename(source) || source || "Unknown project"
  }

  function isSubscriptionActualCostProvider(providerID: string) {
    return providerID === "opencode" || providerID === "opencode-go"
  }

  function billableActualCost(providerID: string, actualCost: number) {
    if (isSubscriptionActualCostProvider(providerID)) return 0
    return actualCost
  }

  type AssistantReadiness = { kind: "foldable" } | { kind: "stale-abandoned"; cutoffAt: number } | { kind: "active-unfinished" }

  function hasTokenEvidence(data: MessageV2.Assistant) {
    return (
      data.tokens.input > 0 ||
      data.tokens.output > 0 ||
      data.tokens.reasoning > 0 ||
      data.tokens.cache.read > 0 ||
      data.tokens.cache.write > 0 ||
      data.cost > 0
    )
  }

  function isTerminalFinish(reason: unknown) {
    if (typeof reason !== "string") return false
    return reason !== "tool-calls" && reason !== "unknown"
  }

  function assistantReadiness(data: MessageV2.Info, now: number, stepUsage?: StepUsage): AssistantReadiness {
    if (data.role !== "assistant") return { kind: "active-unfinished" }
    if (data.time.completed !== undefined) return { kind: "foldable" }
    if (isTerminalFinish(data.finish) || stepUsage?.hasTerminalFinish) return { kind: "foldable" }
    const cutoffAt = now - STALE_UNFINISHED_WINDOW_MS
    const createdAt = data.time.created ?? 0
    if (createdAt > cutoffAt) return { kind: "active-unfinished" }
    if (stepUsage || data.finish !== undefined || hasTokenEvidence(data)) return { kind: "foldable" }
    if (createdAt <= cutoffAt) return { kind: "stale-abandoned", cutoffAt }
    return { kind: "active-unfinished" }
  }

  export function isFoldableAssistantMessage(data: MessageV2.Info): data is MessageV2.Assistant {
    return data.role === "assistant" && assistantReadiness(data, Date.now()).kind === "foldable"
  }

  function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
  }

  function parseTokens(value: unknown): MessageV2.Assistant["tokens"] | undefined {
    if (!value || typeof value !== "object") return undefined
    const tokens = value as Partial<MessageV2.Assistant["tokens"]>
    if (!isFiniteNumber(tokens.input)) return undefined
    if (!isFiniteNumber(tokens.output)) return undefined
    if (!isFiniteNumber(tokens.reasoning)) return undefined
    if (!tokens.cache || typeof tokens.cache !== "object") return undefined
    if (!isFiniteNumber(tokens.cache.read)) return undefined
    if (!isFiniteNumber(tokens.cache.write)) return undefined
    return { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning, cache: { read: tokens.cache.read, write: tokens.cache.write } }
  }

  function emptyStepUsage() {
    return { calls: 0, cost: 0, hasTerminalFinish: false, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
  }

  function addStepTokens(target: MessageV2.Assistant["tokens"], input: MessageV2.Assistant["tokens"]) {
    target.input += input.input
    target.output += input.output
    target.reasoning += input.reasoning
    target.cache.read += input.cache.read
    target.cache.write += input.cache.write
  }

  type StepUsage = ReturnType<typeof emptyStepUsage>

  function providerStepUsageByMessage(db: Database.TxOrDb, messageIDs: string[]) {
    const map = new Map<string, StepUsage>()
    const corrupt = new Set<string>()
    if (messageIDs.length === 0) return map
    const rows = db
      .select({ messageID: PartTable.message_id, data: PartTable.data })
      .from(PartTable)
      .where(inArray(PartTable.message_id, messageIDs))
      .orderBy(PartTable.message_id, PartTable.time_created, PartTable.id)
      .all()
    for (const row of rows) {
      const part = row.data as MessageV2.Part
      if (part?.type !== "step-finish") continue
      const tokens = parseTokens((part as MessageV2.StepFinishPart).tokens)
      if (!tokens) {
        corrupt.add(row.messageID)
        map.delete(row.messageID)
        continue
      }
      if (corrupt.has(row.messageID)) continue
      const usage = map.get(row.messageID) ?? emptyStepUsage()
      usage.calls += 1
      usage.cost += isFiniteNumber((part as MessageV2.StepFinishPart).cost) ? (part as MessageV2.StepFinishPart).cost : 0
      usage.hasTerminalFinish ||= isTerminalFinish((part as MessageV2.StepFinishPart).reason)
      addStepTokens(usage.tokens, tokens)
      map.set(row.messageID, usage)
    }
    return map
  }

  function toStorageRecord(row: {
    message: typeof MessageTable.$inferSelect
    session: typeof SessionTable.$inferSelect
    project: typeof ProjectTable.$inferSelect | null
  }, stepUsage?: StepUsage): ProcessRecord | undefined {
    const data = row.message.data as MessageV2.Info
    const readiness = assistantReadiness(data, Date.now(), stepUsage)
    if (readiness.kind === "active-unfinished") return undefined
    if (readiness.kind === "stale-abandoned") {
      return {
        kind: "skip",
        messageID: row.message.id,
        sessionID: row.session.id,
        watermarkTime: row.message.time_created,
        reason: "stale-unfinished-zero-usage",
        sourceCreatedAt: data.time?.created ?? row.message.time_created,
        cutoffAt: readiness.cutoffAt,
      }
    }
    if (data.role !== "assistant") return undefined
    const timeCreated = data.time.completed ?? data.time.created ?? row.message.time_created
    const tokens = stepUsage?.tokens ?? data.tokens
    const actualCost = stepUsage?.cost ?? data.cost
    const calls = stepUsage?.calls ?? 1
    const pk = computeProjectKey({
      projectWorktree: row.project?.worktree ?? undefined,
      projectID: row.session.project_id,
      directory: row.session.directory,
    })
    const pl = computeProjectLabel({
      projectName: row.project?.name || undefined,
      projectWorktree: row.project?.worktree ?? undefined,
      projectID: row.session.project_id,
      directory: row.session.directory,
    })
    return {
      messageID: row.message.id,
      kind: "fold",
      sessionID: row.session.id,
      sessionTitle: row.session.title,
      directory: row.session.directory,
      projectKey: pk,
      projectLabel: pl,
      provider: data.providerID,
      model: data.modelID,
      agent: data.agent,
      time_created: timeCreated,
      watermarkTime: row.message.time_created,
      actualCost: billableActualCost(data.providerID, actualCost),
      calls,
      tokens: {
        freshInput: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cacheRead: tokens.cache.read,
        cacheWrite: tokens.cache.write,
        total:
          tokens.input +
          tokens.output +
          tokens.reasoning +
          tokens.cache.read +
          tokens.cache.write,
      },
    }
  }

  function roundCost(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000
  }

  /**
   * Upsert a daily aggregate row. Uses UNIQUE(day, provider, model, agent, project_key)
   * to merge or insert.
   */
  function upsertDaily(db: Database.TxOrDb, record: StorageRecord): void {
    const day = toDayString(record.time_created)
    db.insert(AnalyticsDailyTable)
      .values({
        day,
        provider: record.provider,
        model: record.model,
        agent: record.agent,
        project_key: record.projectKey,
        project_label: record.projectLabel,
        directory: record.directory,
        fresh_input: record.tokens.freshInput,
        output: record.tokens.output,
        reasoning: record.tokens.reasoning,
        cache_read: record.tokens.cacheRead,
        cache_write: record.tokens.cacheWrite,
        actual_cost: roundCost(record.actualCost),
        calls: record.calls,
      })
      .onConflictDoUpdate({
        target: [
          AnalyticsDailyTable.day,
          AnalyticsDailyTable.provider,
          AnalyticsDailyTable.model,
          AnalyticsDailyTable.agent,
          AnalyticsDailyTable.project_key,
        ],
        set: {
          project_label: record.projectLabel,
          directory: record.directory,
          fresh_input: sql`${AnalyticsDailyTable.fresh_input} + ${record.tokens.freshInput}`,
          output: sql`${AnalyticsDailyTable.output} + ${record.tokens.output}`,
          reasoning: sql`${AnalyticsDailyTable.reasoning} + ${record.tokens.reasoning}`,
          cache_read: sql`${AnalyticsDailyTable.cache_read} + ${record.tokens.cacheRead}`,
          cache_write: sql`${AnalyticsDailyTable.cache_write} + ${record.tokens.cacheWrite}`,
          actual_cost: sql`round((${AnalyticsDailyTable.actual_cost} + ${record.actualCost}) * 1000000) / 1000000`,
          calls: sql`${AnalyticsDailyTable.calls} + ${record.calls}`,
        },
      })
      .run()
  }

  /** Upsert a session aggregate row. */
  function upsertSession(db: Database.TxOrDb, record: StorageRecord): void {
    db.insert(AnalyticsSessionTable)
      .values({
        session_id: record.sessionID,
        title: record.sessionTitle,
        directory: record.directory,
        project_key: record.projectKey,
        project_label: record.projectLabel,
        provider: record.provider,
        model: record.model,
        agent: record.agent,
        fresh_input: record.tokens.freshInput,
        output: record.tokens.output,
        reasoning: record.tokens.reasoning,
        cache_read: record.tokens.cacheRead,
        cache_write: record.tokens.cacheWrite,
        actual_cost: roundCost(record.actualCost),
        calls: record.calls,
        last_message_at: record.time_created,
      })
      .onConflictDoUpdate({
        target: AnalyticsSessionTable.session_id,
        set: {
          title: record.sessionTitle,
          directory: record.directory,
          project_key: record.projectKey,
          project_label: record.projectLabel,
          provider: record.provider,
          model: record.model,
          agent: record.agent,
          fresh_input: sql`${AnalyticsSessionTable.fresh_input} + ${record.tokens.freshInput}`,
          output: sql`${AnalyticsSessionTable.output} + ${record.tokens.output}`,
          reasoning: sql`${AnalyticsSessionTable.reasoning} + ${record.tokens.reasoning}`,
          cache_read: sql`${AnalyticsSessionTable.cache_read} + ${record.tokens.cacheRead}`,
          cache_write: sql`${AnalyticsSessionTable.cache_write} + ${record.tokens.cacheWrite}`,
          actual_cost: sql`round((${AnalyticsSessionTable.actual_cost} + ${record.actualCost}) * 1000000) / 1000000`,
          calls: sql`${AnalyticsSessionTable.calls} + ${record.calls}`,
          last_message_at: sql`max(${AnalyticsSessionTable.last_message_at}, ${record.time_created})`,
        },
      })
      .run()
  }

  /** Upsert a response row keyed by message_id. */
  function upsertResponse(db: Database.TxOrDb, record: StorageRecord): void {
    db.insert(AnalyticsResponseTable)
      .values({
        message_id: record.messageID,
        session_id: record.sessionID,
        title: record.sessionTitle,
        directory: record.directory,
        project_key: record.projectKey,
        project_label: record.projectLabel,
        provider: record.provider,
        model: record.model,
        agent: record.agent,
        created_at: record.time_created,
        fresh_input: record.tokens.freshInput,
        output: record.tokens.output,
        reasoning: record.tokens.reasoning,
        cache_read: record.tokens.cacheRead,
        cache_write: record.tokens.cacheWrite,
        actual_cost: roundCost(record.actualCost),
        calls: record.calls,
      })
      .onConflictDoNothing()
      .run()
  }

  function upsertSkipped(db: Database.TxOrDb, record: SkippedRecord): void {
    db.insert(AnalyticsSkippedResponseTable)
      .values({
        message_id: record.messageID,
        session_id: record.sessionID,
        reason: record.reason,
        source_created_at: record.sourceCreatedAt,
        cutoff_at: record.cutoffAt,
        skipped_at: Date.now(),
        fresh_input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        cache_write: 0,
        actual_cost: 0,
        calls: 0,
      })
      .onConflictDoUpdate({
        target: AnalyticsSkippedResponseTable.message_id,
        set: {
          reason: record.reason,
          source_created_at: record.sourceCreatedAt,
          cutoff_at: record.cutoffAt,
          skipped_at: Date.now(),
        },
      })
      .run()
  }
}
