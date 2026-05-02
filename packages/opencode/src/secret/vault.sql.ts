// OCO-only file: project-scoped secret vault schema. See oco-dev skill deltas-catalog.md.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { Timestamps } from "@/storage/schema.sql"

export const SecretProfileTable = sqliteTable(
  "secret_profile",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    label: text(),
    enabled: integer({ mode: "boolean" })
      .notNull()
      .$default(() => true),
    ...Timestamps,
  },
  (table) => [
    index("secret_profile_project_idx").on(table.project_id),
    uniqueIndex("secret_profile_project_name_idx").on(table.project_id, table.name),
  ],
)

export const SecretEntryTable = sqliteTable(
  "secret_entry",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    profile_id: text()
      .notNull()
      .references(() => SecretProfileTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    label: text(),
    risk: text().notNull(),
    enabled: integer({ mode: "boolean" })
      .notNull()
      .$default(() => true),
    value_ciphertext: text().notNull(),
    value_iv: text().notNull(),
    value_tag: text().notNull(),
    value_version: integer().notNull(),
    time_used: integer(),
    ...Timestamps,
  },
  (table) => [
    index("secret_entry_project_idx").on(table.project_id),
    index("secret_entry_profile_idx").on(table.profile_id),
    uniqueIndex("secret_entry_profile_name_idx").on(table.profile_id, table.name),
  ],
)
