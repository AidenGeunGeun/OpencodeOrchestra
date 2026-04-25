import SQLite from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

export type Client = BetterSQLite3Database<typeof schema>
export type Journal = { sql: string; timestamp: number }[]

const rawClients = new WeakMap<Client, SQLite.Database>()

export function init(path: string): Client {
  const sqlite = new SQLite(path)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("synchronous = NORMAL")
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("cache_size = -64000")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("wal_checkpoint(PASSIVE)")
  const db = drizzle({ client: sqlite, schema })
  rawClients.set(db, sqlite)
  return db
}

export function migrate(db: Client, migrations: Journal) {
  const sqlite = raw(db)
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" ' +
      "(id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
  )
  const applied = new Set(
    sqlite
      .prepare('SELECT created_at FROM "__drizzle_migrations"')
      .all()
      .map((row) => Number((row as { created_at: number }).created_at)),
  )
  const insert = sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
  const apply = sqlite.transaction((migration: Journal[number]) => {
    sqlite.exec(migration.sql)
    insert.run("", migration.timestamp)
  })
  for (const migration of migrations) {
    if (applied.has(migration.timestamp)) continue
    apply(migration)
  }
}

export function raw(db: Client) {
  const sqlite = rawClients.get(db)
  if (!sqlite) throw new Error("Missing raw SQLite client")
  return sqlite
}
