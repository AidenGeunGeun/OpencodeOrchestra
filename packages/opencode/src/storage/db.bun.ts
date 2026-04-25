import { Database } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate as runMigrations } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./schema"

export type Client = SQLiteBunDatabase<typeof schema>
export type Journal = { sql: string; timestamp: number }[]

const rawClients = new WeakMap<Client, Database>()

export function init(path: string): Client {
  const sqlite = new Database(path, { create: true })
  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  sqlite.run("PRAGMA cache_size = -64000")
  sqlite.run("PRAGMA foreign_keys = ON")
  sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")
  const db = drizzle({ client: sqlite, schema })
  rawClients.set(db, sqlite)
  return db
}

export function migrate(db: Client, migrations: Journal) {
  return runMigrations(db, migrations)
}

export function raw(db: Client) {
  const sqlite = rawClients.get(db)
  if (!sqlite) throw new Error("Missing raw SQLite client")
  return sqlite
}
