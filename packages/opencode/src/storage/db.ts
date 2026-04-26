import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { existsSync, readFileSync, readdirSync } from "fs"
import * as schema from "./schema"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = path.join(Global.Path.data, "oco.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
          return {
            sql: readFileSync(file, "utf-8"),
            timestamp: time(name),
            name,
          }
        })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  function runMigrations(db: Client, migrations: Journal) {
    db.run(
      'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" ' +
        "(id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    )
    const applied = new Set(
      db
        .all<{ created_at: number }>('SELECT created_at FROM "__drizzle_migrations"')
        .map((row) => Number(row.created_at)),
    )
    db.run("BEGIN")
    try {
      for (const migration of migrations) {
        if (applied.has(migration.timestamp)) continue
        for (const statement of migration.sql.split("--> statement-breakpoint")) {
          const sql = statement.trim()
          if (sql.length === 0) continue
          db.run(sql)
        }
        db.run(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('', ${migration.timestamp})`)
      }
      db.run("COMMIT")
    } catch (error) {
      db.run("ROLLBACK")
      throw error
    }
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: path.join(Global.Path.data, "oco.db") })

    const db = init(path.join(Global.Path.data, "oco.db")) as Client

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      runMigrations(db, entries)
    }

    return db
  })

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  type NotPromise<T> = T extends Promise<any> ? never : T

  export function transaction<T>(callback: (tx: TxOrDb) => T): NotPromise<T> {
    try {
      return callback(ctx.use().tx) as NotPromise<T>
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = Client().transaction((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx)) as NotPromise<T>
        })
        for (const effect of effects) effect()
        return result as NotPromise<T>
      }
      throw err
    }
  }
}
