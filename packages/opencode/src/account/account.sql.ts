import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { Timestamps } from "../storage/schema.sql"
import { ControlAccountTable } from "../control/control.sql"
import type { AccessToken, AccountID, OrgID, RefreshToken } from "./schema"

export const AccountTable = sqliteTable("account", {
  id: text().$type<AccountID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccessToken>().notNull(),
  refresh_token: text().$type<RefreshToken>().notNull(),
  token_expiry: integer(),
  ...Timestamps,
})

export const AccountStateTable = sqliteTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<OrgID>(),
})

export { ControlAccountTable }
