// OCO-only file: one-time analytics token backfill from step-finish parts.
import { Database, eq, sql } from "@/storage/db"
import {
  AnalyticsDailyTable,
  AnalyticsResponseTable,
  AnalyticsSessionTable,
  AnalyticsTokenMigrationStateTable,
  AnalyticsWatermarkTable,
} from "./analytics-summary.sql"
import { MessageTable, PartTable } from "./session.sql"
import type { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "analytics.token-migration" })

export namespace AnalyticsTokenMigration {
  export const ID = "step_finish_token_sum_v1"
  export type Status = "pending" | "in_progress" | "completed"
  export type Progress = { total: number; processed: number }
  export type Summary = {
    considered: number
    rewritten: number
    skipped: {
      noStepFinish: number
      singleStepFinish: number
      corruptStepFinish: number
      alreadyCorrect: number
    }
  }

  type TokenBuckets = MessageV2.Assistant["tokens"]

  let running = false

  function emptyTokens(): TokenBuckets {
    return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  }

  function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
  }

  function parseTokens(value: unknown): TokenBuckets | undefined {
    if (!value || typeof value !== "object") return undefined
    const tokens = value as Partial<TokenBuckets>
    if (!isFiniteNumber(tokens.input)) return undefined
    if (!isFiniteNumber(tokens.output)) return undefined
    if (!isFiniteNumber(tokens.reasoning)) return undefined
    if (!tokens.cache || typeof tokens.cache !== "object") return undefined
    if (!isFiniteNumber(tokens.cache.read)) return undefined
    if (!isFiniteNumber(tokens.cache.write)) return undefined
    return {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: { read: tokens.cache.read, write: tokens.cache.write },
    }
  }

  function addTokens(target: TokenBuckets, input: TokenBuckets) {
    target.input += input.input
    target.output += input.output
    target.reasoning += input.reasoning
    target.cache.read += input.cache.read
    target.cache.write += input.cache.write
  }

  function sameTokens(left: TokenBuckets | undefined, right: TokenBuckets) {
    return (
      left !== undefined &&
      left.input === right.input &&
      left.output === right.output &&
      left.reasoning === right.reasoning &&
      left.cache.read === right.cache.read &&
      left.cache.write === right.cache.write
    )
  }

  export function isRunning() {
    return running
  }

  export function state(): Status {
    const row = Database.use((db) =>
      db
        .select({ status: AnalyticsTokenMigrationStateTable.status })
        .from(AnalyticsTokenMigrationStateTable)
        .where(eq(AnalyticsTokenMigrationStateTable.id, ID))
        .get(),
    )
    return row?.status ?? "pending"
  }

  export function progress(): Progress | undefined {
    const row = Database.use((db) =>
      db
        .select({
          total: AnalyticsTokenMigrationStateTable.total_messages,
          processed: AnalyticsTokenMigrationStateTable.processed_messages,
        })
        .from(AnalyticsTokenMigrationStateTable)
        .where(eq(AnalyticsTokenMigrationStateTable.id, ID))
        .get(),
    )
    if (!row) return undefined
    return { total: row.total, processed: row.processed }
  }

  function countAssistantMessages() {
    return Database.use((db) => {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(MessageTable)
        .where(sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`)
        .get()
      return row?.count ?? 0
    })
  }

  function markInProgress(total: number) {
    Database.use((db) => {
      db.insert(AnalyticsTokenMigrationStateTable)
        .values({
          id: ID,
          status: "in_progress",
          processed_messages: 0,
          total_messages: total,
          updated_at: Date.now(),
        })
        .onConflictDoUpdate({
          target: AnalyticsTokenMigrationStateTable.id,
          set: {
            status: "in_progress",
            processed_messages: 0,
            total_messages: total,
            updated_at: Date.now(),
          },
        })
        .run()
    })
  }

  function clearSummaryTables(db: Database.TxOrDb) {
    db.delete(AnalyticsDailyTable).run()
    db.delete(AnalyticsSessionTable).run()
    db.delete(AnalyticsResponseTable).run()
    db.delete(AnalyticsWatermarkTable).run()
  }

  function stepFinishParts(db: Database.TxOrDb, messageID: string) {
    const rows = db
      .select({ id: PartTable.id, data: PartTable.data })
      .from(PartTable)
      .where(eq(PartTable.message_id, messageID))
      .orderBy(PartTable.time_created, PartTable.id)
      .all()
    return rows
      .map((row) => ({ id: row.id, data: row.data as MessageV2.Part }))
      .filter((row) => row.data?.type === "step-finish")
  }

  function rewriteRows(db: Database.TxOrDb): Summary {
    const summary: Summary = {
      considered: 0,
      rewritten: 0,
      skipped: { noStepFinish: 0, singleStepFinish: 0, corruptStepFinish: 0, alreadyCorrect: 0 },
    }
    const rows = db
      .select({ id: MessageTable.id, data: MessageTable.data })
      .from(MessageTable)
      .where(sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`)
      .orderBy(MessageTable.time_created, MessageTable.id)
      .all()

    for (const row of rows) {
      summary.considered += 1
      let parts: ReturnType<typeof stepFinishParts>
      try {
        parts = stepFinishParts(db, row.id)
      } catch (error) {
        summary.skipped.corruptStepFinish += 1
        log.warn("skipping assistant row with unreadable step-finish parts", {
          messageID: row.id,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (parts.length === 0) {
        summary.skipped.noStepFinish += 1
        continue
      }
      if (parts.length === 1) {
        summary.skipped.singleStepFinish += 1
        continue
      }

      const total = emptyTokens()
      let corrupt = false
      for (const part of parts) {
        const tokens = parseTokens((part.data as MessageV2.StepFinishPart).tokens)
        if (!tokens) {
          corrupt = true
          break
        }
        addTokens(total, tokens)
      }
      if (corrupt) {
        summary.skipped.corruptStepFinish += 1
        log.warn("skipping assistant row with corrupt step-finish token data", { messageID: row.id })
        continue
      }

      const data = row.data as MessageV2.Assistant
      if (sameTokens(parseTokens(data.tokens), total)) {
        summary.skipped.alreadyCorrect += 1
        continue
      }

      db.update(MessageTable)
        .set({ data: { ...(row.data as any), tokens: total } })
        .where(eq(MessageTable.id, row.id))
        .run()
      summary.rewritten += 1
    }
    return summary
  }

  export async function ensureCompleted(options: { onProgress?: (event: Progress & { label: string }) => void } = {}) {
    if (state() === "completed") return { skipped: true as const }
    if (running) {
      while (running) await new Promise((resolve) => setTimeout(resolve, 100))
      return { skipped: state() === "completed" } as const
    }
    running = true
    const total = countAssistantMessages()
    markInProgress(total)
    options.onProgress?.({ total, processed: 0, label: "Recalculating historical token totals" })
    try {
      const summary = Database.transaction((db) => {
        const result = rewriteRows(db)
        clearSummaryTables(db)
        db.update(AnalyticsTokenMigrationStateTable)
          .set({
            status: "completed",
            processed_messages: total,
            total_messages: total,
            updated_at: Date.now(),
          })
          .where(eq(AnalyticsTokenMigrationStateTable.id, ID))
          .run()
        return result
      })
      options.onProgress?.({ total, processed: total, label: "Recalculating historical token totals" })
      log.info("historical token migration complete", {
        rowsConsidered: summary.considered,
        rowsRewritten: summary.rewritten,
        rowsSkipped: summary.skipped,
      })
      return { skipped: false as const, summary }
    } finally {
      running = false
    }
  }
}
