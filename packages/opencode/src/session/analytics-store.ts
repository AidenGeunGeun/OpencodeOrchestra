import { sql, eq, gt, gte, lte, and, or, type SQL } from "drizzle-orm"
import { Database } from "@/storage/db"
import {
  AnalyticsDailyTable,
  AnalyticsSessionTable,
  AnalyticsResponseTable,
  AnalyticsWatermarkTable,
} from "./analytics-summary.sql"
import { MessageTable, SessionTable } from "./session.sql"
import { ProjectTable } from "@/project/project.sql"
import type { MessageV2 } from "./message-v2"
import path from "node:path"
import { Log } from "../util/log"

const log = Log.create({ service: "analytics.store" })

const BACKFILL_CHUNK_SIZE = 250
const BACKFILL_YIELD_INTERVAL_MS = 16 // ~1 frame at 60fps — keeps UI responsive

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
    if (wm.processed_messages < wm.total_messages) return "backfilling"
    return "ready"
  }

  export function progress(): Progress | undefined {
    const wm = readWatermark()
    if (!wm || wm.total_messages === 0) return undefined
    return { total: wm.total_messages, processed: wm.processed_messages }
  }

  /** Seed the watermark with an accurate total count so the first UI response can show progress. */
  export function prepareBackfill(): Progress {
    const total = countAssistantMessages()
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
    return { total, processed: readWatermark()?.processed_messages ?? 0 }
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
        // New messages appeared since last count.
        db.update(AnalyticsWatermarkTable)
          .set({ total_messages: total, updated_at: Date.now() })
          .where(eq(AnalyticsWatermarkTable.id, 1))
          .run()
      }
    })

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

    // Mark complete if not already.
    Database.use((db) => {
      const wm = db
        .select()
        .from(AnalyticsWatermarkTable)
        .where(eq(AnalyticsWatermarkTable.id, 1))
        .get()
      if (wm && wm.processed_messages < wm.total_messages) {
        db.update(AnalyticsWatermarkTable)
          .set({
            processed_messages: wm.total_messages,
            updated_at: Date.now(),
          })
          .where(eq(AnalyticsWatermarkTable.id, 1))
          .run()
      }
    })
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

      let maxTimeCreated = afterTime
      let maxMessageID = afterID

      for (const row of rows) {
        const record = toStorageRecord(row)
        if (!record) continue
        upsertDaily(db, record)
        upsertSession(db, record)
        upsertResponse(db, record)
        if (record.watermarkTime > maxTimeCreated || (record.watermarkTime === maxTimeCreated && record.messageID > maxMessageID)) {
          maxTimeCreated = record.watermarkTime
          maxMessageID = record.messageID
        }
      }

      // Advance watermark.
      db.update(AnalyticsWatermarkTable)
        .set({
          last_time_created: maxTimeCreated,
          last_message_id: maxMessageID,
          processed_messages: sql`${AnalyticsWatermarkTable.processed_messages} + ${rows.length}`,
          updated_at: Date.now(),
        })
        .where(eq(AnalyticsWatermarkTable.id, 1))
        .run()

      return rows.length
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
      db.delete(AnalyticsWatermarkTable).run()
    })
    log.info("summary store cleared for rebuild")
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  interface StorageRecord {
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
    tokens: {
      freshInput: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }

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

  function toStorageRecord(row: {
    message: typeof MessageTable.$inferSelect
    session: typeof SessionTable.$inferSelect
    project: typeof ProjectTable.$inferSelect | null
  }): StorageRecord | undefined {
    const data = row.message.data as MessageV2.Info
    if (data.role !== "assistant") return undefined
    const timeCreated = data.time.completed ?? data.time.created ?? row.message.time_created
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

  function roundCost(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000
  }

  /**
   * Upsert a daily aggregate row. Uses UNIQUE(day, provider, model, agent, project_key)
   * to merge or insert.
   */
  function upsertDaily(db: Database.TxOrDb, record: StorageRecord): void {
    const day = toDayString(record.time_created)
    const existing = db
      .select()
      .from(AnalyticsDailyTable)
      .where(
        and(
          eq(AnalyticsDailyTable.day, day),
          eq(AnalyticsDailyTable.provider, record.provider),
          eq(AnalyticsDailyTable.model, record.model),
          eq(AnalyticsDailyTable.agent, record.agent),
          eq(AnalyticsDailyTable.project_key, record.projectKey),
        ),
      )
      .get()

    if (existing) {
      db.update(AnalyticsDailyTable)
        .set({
          fresh_input: existing.fresh_input + record.tokens.freshInput,
          output: existing.output + record.tokens.output,
          reasoning: existing.reasoning + record.tokens.reasoning,
          cache_read: existing.cache_read + record.tokens.cacheRead,
          cache_write: existing.cache_write + record.tokens.cacheWrite,
          actual_cost: roundCost(existing.actual_cost + record.actualCost),
          calls: existing.calls + 1,
        })
        .where(eq(AnalyticsDailyTable.id, existing.id))
        .run()
    } else {
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
          calls: 1,
          session_count: 0, // Updated separately via session dedup
        })
        .run()
    }
  }

  /** Upsert a session aggregate row. */
  function upsertSession(db: Database.TxOrDb, record: StorageRecord): void {
    const existing = db
      .select()
      .from(AnalyticsSessionTable)
      .where(eq(AnalyticsSessionTable.session_id, record.sessionID))
      .get()

    if (existing) {
      db.update(AnalyticsSessionTable)
        .set({
          fresh_input: existing.fresh_input + record.tokens.freshInput,
          output: existing.output + record.tokens.output,
          reasoning: existing.reasoning + record.tokens.reasoning,
          cache_read: existing.cache_read + record.tokens.cacheRead,
          cache_write: existing.cache_write + record.tokens.cacheWrite,
          actual_cost: roundCost(existing.actual_cost + record.actualCost),
          calls: existing.calls + 1,
          last_message_at: Math.max(existing.last_message_at, record.time_created),
          provider: record.provider || existing.provider,
          model: record.model || existing.model,
          agent: record.agent || existing.agent,
        })
        .where(eq(AnalyticsSessionTable.session_id, record.sessionID))
        .run()
    } else {
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
          calls: 1,
          last_message_at: record.time_created,
        })
        .run()
    }
  }

  /** Upsert a response row. Uses onConflictDoNothing since message_id is the PK. */
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
      })
      .onConflictDoNothing()
      .run()
  }
}
