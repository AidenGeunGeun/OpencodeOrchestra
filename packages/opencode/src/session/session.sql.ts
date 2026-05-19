import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text(),
    parent_id: text(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: string; partID?: string; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_directory_recent_idx").on(
      table.project_id,
      table.workspace_id,
      table.directory,
      table.parent_id,
      table.time_updated,
    ),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [
    // OCO: message_session_idx was subsumed by message_session_time_id_idx
    // (same leading column); the 20260519120000_message_session_time_id_index
    // migration drops it. Keeping message_time_created_idx for cross-session
    // time-range queries.
    index("message_time_created_idx").on(table.time_created),
    // OCO: compound index drives keyset cursor pagination in MessageV2.stream.
    // Migration adds DESC; schema lists columns only (existing convention).
    index("message_session_time_id_idx").on(table.session_id, table.time_created, table.id),
    // OCO: `message_role_time_idx` is an EXPRESSION index on
    // `(json_extract(data,'$.role'), time_created, id)` — defined by the
    // 20260519130000_message_role_idx migration because drizzle's column-only
    // schema can't express it. Drives every assistant-role filter:
    //   - analytics.ts `records()` summary path
    //   - analytics-store.ts `processChunk()`, `countAssistantMessages()`,
    //     `hasPendingRowAfterWatermark()`
    //   - analytics-token-migration.ts scans
    // If you rewrite any of those WHERE clauses, keep the expression text byte-
    // identical (`json_extract("message"."data", '$.role') = 'assistant'`) so
    // SQLite can match the index.
  ],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const OrchestratorCompletionTable = sqliteTable(
  "orchestrator_completion",
  {
    child_session_id: text()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    parent_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text({ enum: ["completed", "failed", "cancelled"] }).notNull(),
    summary: text().notNull(),
    learnings: text({ mode: "json" }).$type<string[]>(),
    message_id: text().references(() => MessageTable.id, { onDelete: "set null" }),
    part_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_completion_parent_idx").on(table.parent_session_id),
    index("orchestrator_completion_message_idx").on(table.message_id),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})
