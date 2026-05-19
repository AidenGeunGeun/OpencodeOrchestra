import { Database } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate as runMigrations } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./schema"

export type Client = SQLiteBunDatabase<typeof schema>
export type Journal = { sql: string; timestamp: number; name: string }[]

const rawClients = new WeakMap<Client, Database>()

export function init(path: string): Client {
  const sqlite = new Database(path, { create: true })
  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  // OCO: page cache sized for multi-GB DBs (256 MiB; was 64 MiB).
  sqlite.run("PRAGMA cache_size = -262144")
  // OCO: temp btrees/tables in memory; cheap and helps large ORDER BY / GROUP BY.
  sqlite.run("PRAGMA temp_store = MEMORY")
  // OCO: 256 MiB mmap window — big read-side win on multi-GB DBs.
  sqlite.run("PRAGMA mmap_size = 268435456")
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

export function json(sqlite: Database) {
  return drizzle({ client: sqlite })
}
