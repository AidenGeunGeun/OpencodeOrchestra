#!/usr/bin/env bun
/**
 * OCO perf benchmark harness — runs apples-to-apples A/B against the user's
 * actual local DB without touching it.
 *
 * SAFETY CONTRACT:
 *   - The live DB at ~/.local/share/oco/oco.db is opened only for `VACUUM INTO`.
 *     That statement reads from the source and writes only to the target file;
 *     it does not modify any session, message, or analytics row.
 *   - All snapshots, migrated copies, and ad-hoc work land in
 *     /tmp/oco-bench/. Clean with `bun script/perf-bench.ts clean`.
 *   - `migrate` and any future destructive ops accept a path argument and
 *     refuse paths under ~/.local/share/oco/. The live DB is never an
 *     acceptable target.
 *
 * Usage:
 *   bun script/perf-bench.ts snapshot                   # snapshot live → /tmp/oco-bench/
 *   bun script/perf-bench.ts run <path>                 # benchmark queries against a DB
 *   bun script/perf-bench.ts migrate <path>             # apply pending OCO migrations to a copy
 *   bun script/perf-bench.ts compare                    # snapshot + bench + migrate + bench + diff
 *   bun script/perf-bench.ts boot-stall <dir>           # spawn oco serve, time the boot-stall scenario
 *   bun script/perf-bench.ts clean                      # rm -rf /tmp/oco-bench/
 */
import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite"
import { spawn } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const LIVE_DB_DIR = join(homedir(), ".local", "share", "oco")
const LIVE_DB = join(LIVE_DB_DIR, "oco.db")
const SNAPSHOT_DIR = join(tmpdir(), "oco-bench")
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migration")

// Pragmas matching the post-P0.2 production configuration. Applied to every
// connection the benchmark opens so the harness measures the same hot/cold
// behavior the running app would see.
const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA cache_size = -262144",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA mmap_size = 268435456",
  "PRAGMA foreign_keys = ON",
] as const

function bytes(n: number) {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function assertNotLive(path: string) {
  const abs = resolve(path)
  if (abs.startsWith(resolve(LIVE_DB_DIR))) {
    throw new Error(`Refusing destructive op on a path under ${LIVE_DB_DIR}: ${abs}`)
  }
}

async function snapshot(): Promise<string> {
  if (!existsSync(LIVE_DB)) throw new Error(`Live DB not found at ${LIVE_DB}`)
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const target = join(SNAPSHOT_DIR, `baseline-${stamp()}.db`)
  // Open the live DB for the minimum time needed for VACUUM INTO. VACUUM INTO
  // is a writer-safe operation against the source — it streams a defragmented
  // copy to `target` and does not mutate the source pages. We do not run any
  // other statement on this handle.
  const live = new BunDatabase(LIVE_DB)
  try {
    const sourceSize = statSync(LIVE_DB).size
    console.log(`Snapshotting ${LIVE_DB} (${bytes(sourceSize)}) → ${target}`)
    const start = performance.now()
    live.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    const ms = performance.now() - start
    console.log(`Snapshot complete: ${bytes(statSync(target).size)} in ${ms.toFixed(0)} ms`)
  } finally {
    live.close()
  }
  return target
}

interface Migration {
  name: string
  sql: string
  timestamp: number
}
// OCO: must match `time()` in packages/opencode/src/storage/db.ts — the migration
// runner stores `created_at` as a Unix-ms (UTC) timestamp parsed from the
// directory name's YYYYMMDDhhmmss prefix, NOT the raw digit string.
function migrationTimestamp(name: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
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
function listMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf-8"),
      timestamp: migrationTimestamp(name),
    }))
}

function migrate(path: string) {
  assertNotLive(path)
  const db = new BunDatabase(path)
  for (const p of PRAGMAS) db.run(p)
  db.run(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)',
  )
  const applied = new Set(
    (db.prepare('SELECT created_at FROM "__drizzle_migrations"').all() as { created_at: number }[]).map((r) =>
      Number(r.created_at),
    ),
  )
  const pending = listMigrations().filter((m) => !applied.has(m.timestamp))
  console.log(`Applying ${pending.length} pending migration(s) to ${path}`)
  db.run("BEGIN")
  try {
    for (const m of pending) {
      const start = performance.now()
      for (const stmt of m.sql.split("--> statement-breakpoint")) {
        const s = stmt.trim()
        if (!s) continue
        db.run(s)
      }
      db.run(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('', ${m.timestamp})`)
      const ms = performance.now() - start
      console.log(`  ${m.name}: ${ms.toFixed(0)} ms`)
    }
    db.run("COMMIT")
  } catch (err) {
    db.run("ROLLBACK")
    db.close()
    throw err
  }
  // Mirror the production startup: refresh planner stats so the very next
  // benchmark query sees fresh selectivity for any new index.
  db.run("PRAGMA optimize")
  db.close()
}

interface BenchResult {
  name: string
  medianMs: number
  samples: number[]
  rows: number
  plan: string
}

function benchOne(db: BunDatabase, name: string, sql: string, params: SQLQueryBindings[] = []): BenchResult {
  const stmt = db.prepare(sql)
  // Warm-up so we measure steady-state, not first-call planner cost.
  stmt.all(...params)
  const samples: number[] = []
  let rows = 0
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    const r = stmt.all(...params) as unknown[]
    samples.push(performance.now() - start)
    rows = r.length
  }
  samples.sort((a, b) => a - b)
  let plan = ""
  try {
    const planRows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
    plan = planRows.map((r) => r.detail).join(" | ")
  } catch {
    /* EXPLAIN QUERY PLAN unsupported for some statements; ignore. */
  }
  return { name, medianMs: samples[Math.floor(samples.length / 2)], samples, rows, plan }
}

// Drive the SQL shapes used by the production code paths. Comments reference
// the call site each shape replicates.
function run(path: string): BenchResult[] {
  const db = new BunDatabase(path)
  for (const p of PRAGMAS) db.run(p)

  // Pick the session with the most messages — that's where pagination cost
  // actually shows up. Falls back to the most-recently-updated session.
  const candidate = db
    .prepare(
      "SELECT session_id AS id, COUNT(*) AS n FROM message GROUP BY session_id ORDER BY n DESC LIMIT 1",
    )
    .get() as { id: string; n: number } | undefined
  const session = candidate ?? (db.prepare("SELECT id, 0 AS n FROM session ORDER BY time_updated DESC LIMIT 1").get() as
    | { id: string; n: number }
    | undefined)
  if (!session) throw new Error(`No sessions in ${path}; nothing to benchmark.`)

  const msgCount = session.n
  // For OFFSET vs KEYSET comparison: pick a cursor halfway through.
  const middle =
    msgCount >= 2
      ? (db
          .prepare(
            "SELECT time_created, id FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1 OFFSET ?",
          )
          .get(session.id, Math.max(0, Math.floor(msgCount / 2) - 1)) as
          | { time_created: number; id: string }
          | undefined)
      : undefined
  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000

  // Title search needle: take a 4-char substring from a real session title for a
  // realistic LIKE %needle% search pattern. Empty needle if there's no title.
  const titleSample = db.prepare("SELECT title FROM session WHERE title != '' ORDER BY time_updated DESC LIMIT 1").get() as
    | { title: string }
    | undefined
  const needle =
    titleSample?.title && titleSample.title.length >= 4
      ? titleSample.title.slice(0, 4)
      : (titleSample?.title ?? "fix")

  console.log(`Working session: ${session.id} (${msgCount} messages)`)
  if (middle) console.log(`Mid cursor: time=${middle.time_created}, id=${middle.id}`)
  console.log(`Title needle: "${needle}"`)

  const out: BenchResult[] = []

  // ---- Cold-load sidebar flow ----------------------------------------------
  // Mirrors Session.listWithStats (packages/opencode/src/session/index.ts:884):
  // ORDER BY time_updated DESC LIMIT 100. No WHERE in the common case.
  out.push(benchOne(db, "sidebar.list_100", "SELECT * FROM session ORDER BY time_updated DESC LIMIT 100"))

  // ---- Sidebar with directory filter (typical when navigating directories) -
  // session_directory_recent_idx is supposed to cover this. We don't know the
  // user's actual project_id without inspection, so we use the busiest one.
  const proj = db
    .prepare(
      "SELECT project_id AS id, COUNT(*) AS n FROM session WHERE project_id != '' GROUP BY project_id ORDER BY n DESC LIMIT 1",
    )
    .get() as { id: string; n: number } | undefined
  if (proj) {
    out.push(
      benchOne(
        db,
        "sidebar.list_by_project",
        "SELECT * FROM session WHERE project_id = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT 100",
        [proj.id],
      ),
    )
  }

  // ---- Open a session (single page) ---------------------------------------
  out.push(
    benchOne(
      db,
      "open_session.first_page",
      "SELECT * FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 50",
      [session.id],
    ),
  )

  // ---- Scroll back deep — OFFSET vs KEYSET on the same depth --------------
  if (middle && msgCount >= 100) {
    out.push(
      benchOne(
        db,
        "scroll_mid.OFFSET",
        "SELECT * FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 50 OFFSET ?",
        [session.id, Math.floor(msgCount / 2)],
      ),
    )
    out.push(
      benchOne(
        db,
        "scroll_mid.KEYSET",
        "SELECT * FROM message WHERE session_id = ? AND (time_created, id) < (?, ?) ORDER BY time_created DESC, id DESC LIMIT 50",
        [session.id, middle.time_created, middle.id],
      ),
    )
  }

  // ---- "Scroll back through the entire session" — cumulative cost ---------
  // Real flow: user opens a long session and pages backward until the start.
  // This is the cost MessageV2.stream actually pays. We do NOT pre-warm the
  // statement so we measure full iteration; one sample (median over 3 outer
  // runs would amplify total time too much on a 2.5GB DB).
  const stmtPaginate = db.prepare(
    "SELECT * FROM message WHERE session_id = ? AND (time_created, id) < (?, ?) ORDER BY time_created DESC, id DESC LIMIT 50",
  )
  const stmtFirstPage = db.prepare(
    "SELECT * FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 50",
  )
  const paginateAll = () => {
    let cursor: { time_created: number; id: string } | undefined
    let pages = 0
    let total = 0
    let rows = stmtFirstPage.all(session.id) as { time_created: number; id: string }[]
    while (rows.length > 0) {
      pages++
      total += rows.length
      const last = rows[rows.length - 1]
      cursor = { time_created: last.time_created, id: last.id }
      if (rows.length < 50) break
      rows = stmtPaginate.all(session.id, cursor.time_created, cursor.id) as { time_created: number; id: string }[]
    }
    return { pages, total }
  }
  // Warm-up
  const probe = paginateAll()
  const paginateSamples: number[] = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    paginateAll()
    paginateSamples.push(performance.now() - start)
  }
  paginateSamples.sort((a, b) => a - b)
  const paginatePlanRows = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM message WHERE session_id = ? AND (time_created, id) < (?, ?) ORDER BY time_created DESC, id DESC LIMIT 50",
    )
    .all(session.id, 0, "") as { detail: string }[]
  out.push({
    name: `scroll_full.${probe.pages}pages_${probe.total}msgs`,
    medianMs: paginateSamples[Math.floor(paginateSamples.length / 2)],
    samples: paginateSamples,
    rows: probe.total,
    plan: paginatePlanRows.map((r) => r.detail).join(" | "),
  })

  // ---- Session search (LIKE on title) -------------------------------------
  out.push(
    benchOne(
      db,
      "search.title_LIKE",
      "SELECT * FROM session WHERE title LIKE ? ORDER BY time_updated DESC LIMIT 100",
      [`%${needle}%`],
    ),
  )

  // ---- Analytics queries --------------------------------------------------
  out.push(
    benchOne(
      db,
      "analytics.count_all_assistant",
      "SELECT COUNT(*) AS n FROM message WHERE json_extract(data, '$.role') = 'assistant'",
    ),
  )
  out.push(
    benchOne(
      db,
      "analytics.count_recent_assistant",
      "SELECT COUNT(*) AS n FROM message WHERE json_extract(data, '$.role') = 'assistant' AND time_created >= ?",
      [cutoff30d],
    ),
  )
  // The big one — Analytics.records() at packages/opencode/src/session/analytics.ts:940:
  //   SELECT message, session, project
  //     FROM message INNER JOIN session ON message.session_id = session.id
  //                  LEFT JOIN project ON session.project_id = project.id
  //     WHERE json_extract(data,'$.role') = 'assistant'
  //       [AND time_created >= start]
  out.push(
    benchOne(
      db,
      "analytics.records_recent",
      `SELECT message.*, session.directory, project.id AS project_id
         FROM message
         INNER JOIN session ON message.session_id = session.id
         LEFT JOIN project ON session.project_id = project.id
         WHERE json_extract(message.data, '$.role') = 'assistant'
           AND message.time_created >= ?`,
      [cutoff30d],
    ),
  )

  db.close()
  return out
}

function printResults(label: string, results: BenchResult[]) {
  console.log(`\n=== ${label} ===`)
  for (const r of results) {
    console.log(`  ${r.name.padEnd(34)} ${r.medianMs.toFixed(1).padStart(9)} ms  (${r.rows} rows)`)
    if (r.plan) console.log(`    plan: ${r.plan}`)
  }
}

function diff(before: BenchResult[], after: BenchResult[]) {
  console.log(`\n=== DIFF (median; >1.00x = faster after migration) ===`)
  console.log(`  ${"query".padEnd(34)} ${"before".padStart(12)} ${"after".padStart(12)} ${"speedup".padStart(10)}`)
  for (const b of before) {
    const a = after.find((x) => x.name === b.name)
    if (!a) continue
    const speedup = b.medianMs / a.medianMs
    console.log(
      `  ${b.name.padEnd(34)} ${b.medianMs.toFixed(1).padStart(9)} ms ${a.medianMs.toFixed(1).padStart(9)} ms ${speedup.toFixed(2).padStart(8)}x`,
    )
  }
}

function clean() {
  if (!existsSync(SNAPSHOT_DIR)) {
    console.log(`Nothing to clean: ${SNAPSHOT_DIR} does not exist`)
    return
  }
  console.log(`Removing ${SNAPSHOT_DIR}`)
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true })
}

// OCO: data-dir snapshot (XDG layout) used by the boot-stall scenario. The
// oco serve subcommand consults XDG_DATA_HOME/oco/{oco.db,storage,auth.json,
// secret-vault.key}, so a full data dir must be staged — not just oco.db.
async function snapshotDataDir(label: string): Promise<string> {
  if (!existsSync(LIVE_DB)) throw new Error(`Live DB not found at ${LIVE_DB}`)
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const root = join(SNAPSHOT_DIR, `${label}-${stamp()}`)
  const xdg = join(root, "oco")
  mkdirSync(xdg, { recursive: true })
  // VACUUM INTO — writer-safe against the source; same guarantee as snapshot().
  const live = new BunDatabase(LIVE_DB)
  try {
    const target = join(xdg, "oco.db")
    console.log(`Snapshotting ${LIVE_DB} → ${target}`)
    live.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    live.close()
  }
  // APFS clonefile via Node cpSync (recursive). The storage/ tree is ~67k
  // small files; clonefile makes this a sub-15s operation on macOS APFS.
  const liveStorage = join(LIVE_DB_DIR, "storage")
  if (existsSync(liveStorage)) {
    console.log(`Cloning ${liveStorage} → ${xdg}/storage`)
    cpSync(liveStorage, join(xdg, "storage"), { recursive: true })
  }
  for (const file of ["auth.json", "secret-vault.key"]) {
    const src = join(LIVE_DB_DIR, file)
    if (existsSync(src)) copyFileSync(src, join(xdg, file))
  }
  return root
}

type ServeBinary = { label: string; cmd: string[]; cwd?: string }

interface BootStallSample {
  request: number
  durationMs: number
  wallMs: number
}

interface BootStallResult {
  label: string
  totalScanMs: number
  samples: BootStallSample[]
  maxDuringScanMs: number
  steadyStateMs: number
}

async function benchBootStall(input: {
  binary: ServeBinary
  dataDir: string
  port: number
  directory: string
  requestCount: number
  postScanSamples: number
}): Promise<BootStallResult> {
  // Spawn oco serve against the snapshot.
  console.log(`\n[${input.binary.label}] spawning serve on port ${input.port}`)
  const env = {
    ...process.env,
    XDG_DATA_HOME: input.dataDir,
    // Force a known empty password so the server is unsecured (matches the
    // headless test mode — the user's running prod app uses a per-launch
    // random password, but for benchmarking, no auth keeps things simple).
    OPENCODE_SERVER_PASSWORD: "",
  }
  const proc = spawn(input.binary.cmd[0], [...input.binary.cmd.slice(1), "serve", "--port", String(input.port), "--hostname", "127.0.0.1"], {
    cwd: input.binary.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let serverOutput = ""
  proc.stdout.on("data", (d) => (serverOutput += d.toString()))
  proc.stderr.on("data", (d) => (serverOutput += d.toString()))

  try {
    // Wait for ready.
    const startedAt = performance.now()
    const url = `http://127.0.0.1:${input.port}`
    const readyDeadline = performance.now() + 30_000
    while (performance.now() < readyDeadline) {
      try {
        const res = await fetch(`${url}/global/health`)
        if (res.ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 100))
    }
    if (performance.now() >= readyDeadline) {
      throw new Error(`[${input.binary.label}] server did not become healthy within 30s.\nOutput:\n${serverOutput}`)
    }
    console.log(`[${input.binary.label}] ready in ${(performance.now() - startedAt).toFixed(0)} ms`)

    // The scenario: hammer /session for the target directory and time each request.
    // The boot-stall manifests as a multi-second spike on request 2-N while the
    // background File.init scan saturates the JS thread.
    const dirParam = encodeURIComponent(input.directory)
    const queryUrl = `${url}/session?directory=${dirParam}&roots=true&limit=100`
    const samples: BootStallSample[] = []
    const benchStart = performance.now()
    for (let i = 1; i <= input.requestCount; i++) {
      const reqStart = performance.now()
      const res = await fetch(queryUrl)
      if (!res.ok) throw new Error(`request ${i} failed: HTTP ${res.status}`)
      await res.text()
      const durationMs = performance.now() - reqStart
      samples.push({ request: i, durationMs, wallMs: performance.now() - benchStart })
    }

    // Wait for the background scan to settle, then measure steady state.
    // Simple heuristic: assume scan done when N consecutive requests are < 50ms.
    const settleDeadline = performance.now() + 120_000
    let steadyCount = 0
    while (performance.now() < settleDeadline && steadyCount < 3) {
      const reqStart = performance.now()
      const res = await fetch(queryUrl)
      await res.text()
      const durationMs = performance.now() - reqStart
      if (durationMs < 50) steadyCount++
      else steadyCount = 0
    }
    const totalScanMs = performance.now() - benchStart

    // Take a few post-scan samples for the steady-state number.
    let steadySum = 0
    for (let i = 0; i < input.postScanSamples; i++) {
      const reqStart = performance.now()
      const res = await fetch(queryUrl)
      await res.text()
      steadySum += performance.now() - reqStart
    }
    const steadyStateMs = steadySum / input.postScanSamples
    const maxDuringScanMs = Math.max(...samples.map((s) => s.durationMs))

    return {
      label: input.binary.label,
      totalScanMs,
      samples,
      maxDuringScanMs,
      steadyStateMs,
    }
  } finally {
    proc.kill()
    await new Promise((r) => setTimeout(r, 500))
  }
}

function printBootStall(result: BootStallResult) {
  console.log(`\n=== ${result.label} ===`)
  console.log(`  scan settled at:       ${result.totalScanMs.toFixed(0)} ms wall`)
  console.log(`  max during scan:       ${result.maxDuringScanMs.toFixed(1)} ms  (← the spike)`)
  console.log(`  steady state (avg):    ${result.steadyStateMs.toFixed(1)} ms`)
  console.log(`  first 5 samples:`)
  for (const s of result.samples.slice(0, 5)) {
    console.log(`    req ${String(s.request).padStart(2)}: ${s.durationMs.toFixed(1).padStart(7)} ms  (at ${s.wallMs.toFixed(0)} ms wall)`)
  }
}

async function bootStall(directory: string) {
  const REPO_OPENCODE = resolve(import.meta.dirname, "..")
  const root = await snapshotDataDir("bootstall")
  const xdg = join(root, "oco")
  console.log(`\nData dir: ${xdg}`)
  console.log(`Target directory (project root): ${directory}`)

  const prodBinary = join(homedir(), ".local", "bin", "oco")
  const binaries: ServeBinary[] = []
  if (existsSync(prodBinary)) {
    binaries.push({ label: `prod (${prodBinary})`, cmd: [prodBinary] })
  } else {
    console.log(`Skipping prod binary — not found at ${prodBinary}`)
  }
  binaries.push({
    label: "dev tree (bun run ./src/index.ts)",
    cmd: ["bun", "run", "--conditions=browser", "./src/index.ts"],
    cwd: REPO_OPENCODE,
  })

  const results: BootStallResult[] = []
  let port = 9876
  for (const binary of binaries) {
    // Each run gets its own data-dir clone so migrations from the dev tree
    // don't pollute the prod-binary run.
    const runRoot = join(SNAPSHOT_DIR, `bootstall-run-${stamp()}`)
    cpSync(root, runRoot, { recursive: true })
    const result = await benchBootStall({
      binary,
      dataDir: join(runRoot, "oco"),
      port,
      directory,
      requestCount: 30,
      postScanSamples: 5,
    })
    results.push(result)
    port++
  }

  console.log("\n========================= boot-stall summary =========================")
  console.log(
    `Project root:    ${directory}\n` +
      `Snapshot root:   ${root}\n` +
      `Scenario:        30 sequential /session?roots=true&limit=100, then settle to steady.`,
  )
  for (const r of results) printBootStall(r)
}

const cmd = process.argv[2] ?? "compare"

if (cmd === "snapshot") {
  console.log(await snapshot())
} else if (cmd === "run") {
  const path = process.argv[3]
  if (!path) {
    console.error("Usage: perf-bench run <path>")
    process.exit(1)
  }
  printResults(`RESULTS (${path})`, run(path))
} else if (cmd === "migrate") {
  const path = process.argv[3]
  if (!path) {
    console.error("Usage: perf-bench migrate <path>")
    process.exit(1)
  }
  migrate(path)
} else if (cmd === "boot-stall") {
  const directory = process.argv[3]
  if (!directory) {
    console.error("Usage: perf-bench boot-stall <project-directory>")
    console.error("Example: perf-bench boot-stall /Users/aidenkim/projects/agents/OCstuff")
    process.exit(1)
  }
  await bootStall(directory)
} else if (cmd === "clean") {
  clean()
} else if (cmd === "compare") {
  const baseline = await snapshot()
  console.log("\n--- benchmarking baseline (live schema) ---")
  const before = run(baseline)
  printResults("BEFORE migrations (live schema)", before)

  const migrated = baseline.replace(/\.db$/, "-migrated.db")
  console.log(`\nCopying baseline → ${migrated}`)
  copyFileSync(baseline, migrated)
  console.log("\n--- applying perf migrations to copy ---")
  migrate(migrated)

  console.log("\n--- benchmarking migrated copy (perf schema) ---")
  const after = run(migrated)
  printResults("AFTER migrations (perf schema)", after)

  diff(before, after)

  console.log(`\nArtifacts retained:`)
  console.log(`  baseline (no new indexes): ${baseline}`)
  console.log(`  migrated (with new indexes): ${migrated}`)
  console.log(`Clean with: bun script/perf-bench.ts clean`)
} else {
  console.error(`Unknown command: ${cmd}`)
  console.error("Usage: bun script/perf-bench.ts [snapshot|run|migrate|compare|clean]")
  process.exit(1)
}
