import type { Argv } from "yargs"
import { spawn } from "child_process"
import fs from "fs"
import { Database } from "../../storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"

function padFixture(value: number, width: number) {
  return value.toString().padStart(width, "0")
}

function fixtureStepCount(index: number) {
  if (index === 123) return 3
  const mode = index % 20
  if (mode <= 8) return 0
  if (mode <= 14) return 2
  if (mode <= 18) return 5 + (index % 26)
  return 1
}

const FIXTURE_IDS = {
  projects: ["proj_fx_alpha", "proj_fx_beta", "proj_fx_gamma", "proj_fx_delta"],
  sessions: Array.from({ length: 154 }, (_, index) => `ses_fx_${padFixture(index, 4)}`),
  messages: [
    ...Array.from({ length: 7_700 }, (_, index) => `msg_fx_${padFixture(index, 5)}`),
    "msg_fx_placeholder",
  ],
  parts: Array.from({ length: 7_700 }, (_, messageIndex) =>
    Array.from({ length: fixtureStepCount(messageIndex) }, (_, stepIndex) => `part_fx_${padFixture(messageIndex, 5)}_${padFixture(stepIndex, 2)}`),
  ).flat(),
  projectKeys: ["/fixture/alpha", "/fixture/beta", "/fixture/gamma", "/fixture/delta"],
}

const FIXTURE_EXPECTED = {
  projects: FIXTURE_IDS.projects.length,
  sessions: FIXTURE_IDS.sessions.length,
  messages: FIXTURE_IDS.messages.length,
  parts: FIXTURE_IDS.parts.length,
}

const FIXTURE_ID_SETS = {
  projects: new Set(FIXTURE_IDS.projects),
  sessions: new Set(FIXTURE_IDS.sessions),
  messages: new Set(FIXTURE_IDS.messages),
  parts: new Set(FIXTURE_IDS.parts),
}

function openReadonly() {
  return new BunDatabase(Database.Path, { readonly: true })
}

function fixtureCounts(db: BunDatabase) {
  const one = (sql: string) => (db.query(sql).get() as { count: number } | undefined)?.count ?? 0
  const ids = (sql: string) => (db.query(sql).all() as { id: string }[]).map((row) => row.id)
  const projects = ids("SELECT id FROM project WHERE id LIKE 'proj_fx_%'")
  const sessions = ids("SELECT id FROM session WHERE id LIKE 'ses_fx_%'")
  const messages = ids("SELECT id FROM message WHERE id LIKE 'msg_fx_%'")
  const parts = ids("SELECT id FROM part WHERE id LIKE 'part_fx_%'")
  const compare = (actual: string[], expected: Set<string>) => ({
    missing: Array.from(expected).filter((id) => !actual.includes(id)).length,
    extra: actual.filter((id) => !expected.has(id)).length,
  })
  return {
    projects: projects.length,
    sessions: sessions.length,
    messages: messages.length,
    parts: parts.length,
    analyticsResponses: one("SELECT count(*) AS count FROM analytics_response WHERE message_id IN (SELECT id FROM message WHERE id GLOB 'msg_fx_[0-9][0-9][0-9][0-9][0-9]' OR id = 'msg_fx_placeholder') OR session_id IN (SELECT id FROM session WHERE id GLOB 'ses_fx_[0-9][0-9][0-9][0-9]')"),
    analyticsSkipped: one("SELECT count(*) AS count FROM analytics_skipped_response WHERE message_id IN (SELECT id FROM message WHERE id GLOB 'msg_fx_[0-9][0-9][0-9][0-9][0-9]' OR id = 'msg_fx_placeholder') OR session_id IN (SELECT id FROM session WHERE id GLOB 'ses_fx_[0-9][0-9][0-9][0-9]')"),
    analyticsSessions: one("SELECT count(*) AS count FROM analytics_session WHERE session_id IN (SELECT id FROM session WHERE id GLOB 'ses_fx_[0-9][0-9][0-9][0-9]') OR project_key IN ('/fixture/alpha','/fixture/beta','/fixture/gamma','/fixture/delta')"),
    analyticsDaily: one("SELECT count(*) AS count FROM analytics_daily WHERE project_key IN ('/fixture/alpha','/fixture/beta','/fixture/gamma','/fixture/delta')"),
    analyticsUnexpected: {
      responses: one("SELECT count(*) AS count FROM analytics_response WHERE (message_id LIKE 'msg_fx_%' AND NOT (message_id GLOB 'msg_fx_[0-9][0-9][0-9][0-9][0-9]' OR message_id = 'msg_fx_placeholder')) OR (session_id LIKE 'ses_fx_%' AND session_id NOT GLOB 'ses_fx_[0-9][0-9][0-9][0-9]')"),
      skipped: one("SELECT count(*) AS count FROM analytics_skipped_response WHERE (message_id LIKE 'msg_fx_%' AND NOT (message_id GLOB 'msg_fx_[0-9][0-9][0-9][0-9][0-9]' OR message_id = 'msg_fx_placeholder')) OR (session_id LIKE 'ses_fx_%' AND session_id NOT GLOB 'ses_fx_[0-9][0-9][0-9][0-9]')"),
      sessions: one("SELECT count(*) AS count FROM analytics_session WHERE (session_id LIKE 'ses_fx_%' AND session_id NOT GLOB 'ses_fx_[0-9][0-9][0-9][0-9]') OR (project_key LIKE '/fixture/%' AND project_key NOT IN ('/fixture/alpha','/fixture/beta','/fixture/gamma','/fixture/delta'))"),
      daily: one("SELECT count(*) AS count FROM analytics_daily WHERE project_key LIKE '/fixture/%' AND project_key NOT IN ('/fixture/alpha','/fixture/beta','/fixture/gamma','/fixture/delta')"),
    },
    manifestDiff: {
      projects: compare(projects, FIXTURE_ID_SETS.projects),
      sessions: compare(sessions, FIXTURE_ID_SETS.sessions),
      messages: compare(messages, FIXTURE_ID_SETS.messages),
      parts: compare(parts, FIXTURE_ID_SETS.parts),
    },
  }
}

function fixtureCountsMatch(counts: ReturnType<typeof fixtureCounts>) {
  return (
    counts.projects === FIXTURE_IDS.projects.length &&
    counts.sessions === FIXTURE_IDS.sessions.length &&
    counts.messages === FIXTURE_IDS.messages.length &&
    counts.parts === FIXTURE_IDS.parts.length &&
    Object.values(counts.manifestDiff).every((item) => item.missing === 0 && item.extra === 0) &&
    Object.values(counts.analyticsUnexpected).every((count) => count === 0)
  )
}

function sqlList(values: string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",")
}

function deleteIDs(db: BunDatabase, table: string, column: string, ids: string[]) {
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    if (chunk.length === 0) continue
    db.run(`DELETE FROM ${table} WHERE ${column} IN (${sqlList(chunk)})`)
  }
}

function printJSON(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.Path], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
  },
})

const AnalyticsPreflightCommand = cmd({
  command: "analytics-preflight",
  describe: "read-only analytics recovery preflight report",
  handler: () => {
    const db = openReadonly()
    try {
      const one = (sql: string) => (db.query(sql).get() as { count: number } | undefined)?.count ?? 0
      const watermark = db.query("SELECT * FROM analytics_watermark WHERE id = 1").get()
      const fixture = fixtureCounts(db)
      printJSON({
        database: Database.Path,
        watermark,
        fixtures: { counts: fixture, expected: FIXTURE_EXPECTED, manifestMatched: fixtureCountsMatch(fixture) },
        abandonedZeroUsage: one(
          "SELECT count(*) AS count FROM message WHERE json_extract(data, '$.role') = 'assistant' AND json_extract(data, '$.time.completed') IS NULL AND json_extract(data, '$.finish') IS NULL AND COALESCE(json_extract(data, '$.tokens.input'), 0) = 0 AND COALESCE(json_extract(data, '$.tokens.output'), 0) = 0 AND COALESCE(json_extract(data, '$.tokens.reasoning'), 0) = 0 AND COALESCE(json_extract(data, '$.tokens.cache.read'), 0) = 0 AND COALESCE(json_extract(data, '$.tokens.cache.write'), 0) = 0 AND COALESCE(json_extract(data, '$.cost'), 0) = 0",
        ),
        foldableAfterApril3Watermark: one(
          "SELECT count(*) AS count FROM message m WHERE time_created > 1775196644000 AND json_extract(data, '$.role') = 'assistant' AND (json_extract(data, '$.time.completed') IS NOT NULL OR json_extract(data, '$.finish') IS NOT NULL OR EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id AND json_extract(p.data, '$.type') = 'step-finish'))",
        ),
        providerStepEvidence: one("SELECT count(*) AS count FROM part WHERE json_extract(data, '$.type') = 'step-finish'"),
        hierarchyCoverage: {
          topLevel: one("SELECT count(*) AS count FROM session s JOIN message m ON m.session_id = s.id WHERE s.parent_id IS NULL AND json_extract(m.data, '$.role') = 'assistant'"),
          directChild: one("SELECT count(*) AS count FROM session s JOIN message m ON m.session_id = s.id JOIN session p ON p.id = s.parent_id WHERE p.parent_id IS NULL AND json_extract(m.data, '$.role') = 'assistant'"),
          nestedDescendant: one("SELECT count(*) AS count FROM session s JOIN message m ON m.session_id = s.id JOIN session p ON p.id = s.parent_id WHERE p.parent_id IS NOT NULL AND json_extract(m.data, '$.role') = 'assistant'"),
        },
      })
    } finally {
      db.close()
    }
  },
})

const AnalyticsFixtureCleanupCommand = cmd({
  command: "analytics-fixture-cleanup",
  describe: "dry-run or approved cleanup of deterministic analytics fixtures",
  builder: (yargs: Argv) =>
    yargs
      .option("dry-run", { type: "boolean", default: true, describe: "report fixture rows without deleting anything" })
      .option("approve-fixture-cleanup", { type: "boolean", default: false, describe: "required to delete fixture rows" })
      .option("backup", { type: "string", describe: "backup database path required for approved cleanup" }),
  handler: (args: { dryRun: boolean; approveFixtureCleanup: boolean; backup?: string }) => {
    const readonly = openReadonly()
    const counts = fixtureCounts(readonly)
    readonly.close()
    const report = { database: Database.Path, counts, expected: FIXTURE_EXPECTED, manifestMatched: fixtureCountsMatch(counts), dryRun: args.dryRun }
    if (args.dryRun) {
      printJSON(report)
      return
    }
    if (!args.approveFixtureCleanup) {
      UI.error("Refusing fixture cleanup without --approve-fixture-cleanup")
      process.exit(1)
    }
    if (!fixtureCountsMatch(counts)) {
      UI.error("Refusing fixture cleanup because fixture counts do not match the deterministic manifest")
      printJSON(report)
      process.exit(1)
    }
    if (!args.backup) {
      UI.error("Refusing fixture cleanup without --backup <path>")
      process.exit(1)
    }
    try {
      const source = new BunDatabase(Database.Path)
      try {
        source.run("PRAGMA wal_checkpoint(FULL)")
      } finally {
        source.close()
      }
      fs.copyFileSync(Database.Path, args.backup, fs.constants.COPYFILE_EXCL)
      const backup = new BunDatabase(args.backup)
      try {
        const backupCounts = fixtureCounts(backup)
        if (JSON.stringify(backupCounts) !== JSON.stringify(counts)) throw new Error("backup fixture counts differ from source")
      } finally {
        backup.close()
      }
    } catch (error) {
      UI.error(`Refusing fixture cleanup because backup failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    const db = new BunDatabase(Database.Path)
    try {
      db.run("BEGIN")
      deleteIDs(db, "analytics_daily", "project_key", FIXTURE_IDS.projectKeys)
      deleteIDs(db, "analytics_session", "session_id", FIXTURE_IDS.sessions)
      deleteIDs(db, "analytics_response", "message_id", FIXTURE_IDS.messages)
      deleteIDs(db, "analytics_skipped_response", "message_id", FIXTURE_IDS.messages)
      deleteIDs(db, "part", "id", FIXTURE_IDS.parts)
      deleteIDs(db, "message", "id", FIXTURE_IDS.messages)
      deleteIDs(db, "session", "id", FIXTURE_IDS.sessions)
      deleteIDs(db, "project", "id", FIXTURE_IDS.projects)
      db.run("DELETE FROM analytics_watermark")
      db.run("COMMIT")
      printJSON({ ...report, dryRun: false, backup: args.backup, deleted: true })
    } catch (error) {
      db.run("ROLLBACK")
      UI.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    } finally {
      db.close()
    }
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(AnalyticsPreflightCommand).command(AnalyticsFixtureCleanupCommand).demandCommand()
  },
  handler: () => {},
})
