import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core"

/**
 * Pre-aggregated daily analytics. One row per (day, provider, model, agent, project_key).
 *
 * `project_key` uses the same logic as the V2 project breakdown key:
 *   - projectWorktree when projectID !== "global", otherwise directory.
 * `project_label` is the display name (projectName or basename of worktree/directory).
 *
 * Stores tokens and actual provider cost only — API-equivalent dollars are computed
 * at read time from the pricing lookup so override file edits take effect on refresh
 * with no re-aggregation.
 */
export const AnalyticsDailyTable = sqliteTable(
  "analytics_daily",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    day: text("day").notNull(), // YYYY-MM-DD
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    agent: text("agent").notNull(),
    project_key: text("project_key").notNull(),
    project_label: text("project_label").notNull().default(""),
    directory: text("directory").notNull().default(""),
    fresh_input: integer("fresh_input").notNull().default(0),
    output: integer("output").notNull().default(0),
    reasoning: integer("reasoning").notNull().default(0),
    cache_read: integer("cache_read").notNull().default(0),
    cache_write: integer("cache_write").notNull().default(0),
    actual_cost: real("actual_cost").notNull().default(0),
    calls: integer("calls").notNull().default(0),
  },
  (table) => [
    uniqueIndex("analytics_daily_unique").on(
      table.day,
      table.provider,
      table.model,
      table.agent,
      table.project_key,
    ),
    index("analytics_daily_day_idx").on(table.day),
    index("analytics_daily_project_key_idx").on(table.project_key),
  ],
)

/**
 * Session-level analytics aggregates. One row per session used for high-impact lists.
 */
export const AnalyticsSessionTable = sqliteTable(
  "analytics_session",
  {
    session_id: text("session_id").primaryKey(),
    title: text("title").notNull().default(""),
    directory: text("directory").notNull().default(""),
    project_key: text("project_key").notNull().default(""),
    project_label: text("project_label").notNull().default(""),
    provider: text("provider").notNull().default(""),
    model: text("model").notNull().default(""),
    agent: text("agent").notNull().default(""),
    fresh_input: integer("fresh_input").notNull().default(0),
    output: integer("output").notNull().default(0),
    reasoning: integer("reasoning").notNull().default(0),
    cache_read: integer("cache_read").notNull().default(0),
    cache_write: integer("cache_write").notNull().default(0),
    actual_cost: real("actual_cost").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    last_message_at: integer("last_message_at").notNull().default(0),
  },
  (table) => [index("analytics_session_project_idx").on(table.project_key)],
)

/**
 * Response-level analytics. One row per assistant message used for high-impact lists
 * and per-message detail.
 */
export const AnalyticsResponseTable = sqliteTable(
  "analytics_response",
  {
    message_id: text("message_id").primaryKey(),
    session_id: text("session_id").notNull(),
    title: text("title").notNull().default(""),
    directory: text("directory").notNull().default(""),
    project_key: text("project_key").notNull().default(""),
    project_label: text("project_label").notNull().default(""),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    agent: text("agent").notNull(),
    created_at: integer("created_at").notNull().default(0),
    fresh_input: integer("fresh_input").notNull().default(0),
    output: integer("output").notNull().default(0),
    reasoning: integer("reasoning").notNull().default(0),
    cache_read: integer("cache_read").notNull().default(0),
    cache_write: integer("cache_write").notNull().default(0),
    actual_cost: real("actual_cost").notNull().default(0),
    calls: integer("calls").notNull().default(1),
  },
  (table) => [
    index("analytics_response_session_idx").on(table.session_id),
    index("analytics_response_created_idx").on(table.created_at),
  ],
)

/**
 * Auditable analytics skips for unfinished assistant placeholders that carry no
 * reliable final usage evidence and are treated as zero-cost tail noise.
 */
export const AnalyticsSkippedResponseTable = sqliteTable(
  "analytics_skipped_response",
  {
    message_id: text("message_id").primaryKey(),
    session_id: text("session_id").notNull().default(""),
    reason: text("reason").notNull(),
    source_created_at: integer("source_created_at").notNull().default(0),
    cutoff_at: integer("cutoff_at").notNull().default(0),
    skipped_at: integer("skipped_at").notNull().default(0),
    fresh_input: integer("fresh_input").notNull().default(0),
    output: integer("output").notNull().default(0),
    reasoning: integer("reasoning").notNull().default(0),
    cache_read: integer("cache_read").notNull().default(0),
    cache_write: integer("cache_write").notNull().default(0),
    actual_cost: real("actual_cost").notNull().default(0),
    calls: integer("calls").notNull().default(0),
  },
  (table) => [index("analytics_skipped_response_reason_idx").on(table.reason)],
)

/**
 * Singleton watermark table tracking backfill and incremental update progress.
 *
 * `id` is always 1 (check constraint). When the summary store is empty or being rebuilt,
 * `last_time_created` is 0. After backfill completes, `last_time_created` holds the max
 * `time_created` of the last aggregated batch.
 */
export const AnalyticsWatermarkTable = sqliteTable(
  "analytics_watermark",
  {
    id: integer("id").primaryKey(),
    last_time_created: integer("last_time_created").notNull().default(0),
    last_message_id: text("last_message_id").notNull().default(""),
    total_messages: integer("total_messages").notNull().default(0),
    processed_messages: integer("processed_messages").notNull().default(0),
    updated_at: integer("updated_at").notNull().default(0),
  },
  () => [],
)

/**
 * One-time historical rewrite state for aggregating assistant message tokens from
 * already-persisted step-finish parts.
 */
export const AnalyticsTokenMigrationStateTable = sqliteTable("analytics_token_migration_state", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["pending", "in_progress", "completed"] }).notNull().default("pending"),
  processed_messages: integer("processed_messages").notNull().default(0),
  total_messages: integer("total_messages").notNull().default(0),
  updated_at: integer("updated_at").notNull().default(0),
})
