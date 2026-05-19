import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"

// OCO: Node SQLite adapter keeps Electron backend off Bun's SQLite runtime.
// Pragmas are mirrored from db.bun.ts:init() so the Electron Node backend gets
// the same large-DB tuning. The duplicate block in db.ts is defense-in-depth.
export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA synchronous = NORMAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA cache_size = -262144")
  sqlite.exec("PRAGMA temp_store = MEMORY")
  sqlite.exec("PRAGMA mmap_size = 268435456")
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec("PRAGMA wal_checkpoint(PASSIVE)")
  const db = drizzle({ client: sqlite })
  return db
}
