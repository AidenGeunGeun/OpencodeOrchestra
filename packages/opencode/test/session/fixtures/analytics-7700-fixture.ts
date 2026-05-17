import { ProjectTable } from "../../../src/project/project.sql"
import { AnalyticsStore } from "../../../src/session/analytics-store"
import { MessageTable, PartTable, SessionTable } from "../../../src/session/session.sql"
import { Database } from "../../../src/storage/db"

export const FIXTURE_NOW = Date.UTC(2026, 4, 16, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000
const ROW_COUNT = 7_700
const SESSION_COUNT = 154

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

const projects = [
  { id: "proj_fx_alpha", worktree: "/fixture/alpha", name: "Fixture Alpha" },
  { id: "proj_fx_beta", worktree: "/fixture/beta", name: "Fixture Beta" },
  { id: "proj_fx_gamma", worktree: "/fixture/gamma", name: "Fixture Gamma" },
  { id: "proj_fx_delta", worktree: "/fixture/delta", name: "Fixture Delta" },
]

export const ANALYTICS_FIXTURE_MESSAGE_COUNT = ROW_COUNT + 1
export const ANALYTICS_FIXTURE_SESSION_COUNT = SESSION_COUNT
export const ANALYTICS_FIXTURE_PROJECT_COUNT = projects.length

const models = [
  { provider: "openai", model: "gpt-fixture", inputRate: 2, outputRate: 8 },
  { provider: "anthropic", model: "claude-fixture", inputRate: 3, outputRate: 15 },
  { provider: "opencode", model: "subscription-fixture", inputRate: 1.5, outputRate: 7 },
  { provider: "openai", model: "gpt-fixture-mini", inputRate: 0.5, outputRate: 2 },
]

const agents = ["build", "orchestrator", "investigator", "auditor", "docs"]

function pad(value: number, width: number) {
  return value.toString().padStart(width, "0")
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function addTokens(target: Tokens, input: Tokens) {
  target.input += input.input
  target.output += input.output
  target.reasoning += input.reasoning
  target.cache.read += input.cache.read
  target.cache.write += input.cache.write
}

function totalTokens(tokens: Tokens) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function sameTokens(left: Tokens, right: Tokens) {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.reasoning === right.reasoning &&
    left.cache.read === right.cache.read &&
    left.cache.write === right.cache.write
  )
}

function stepTokens(index: number, step: number): Tokens {
  return {
    input: 800 + (index % 97) * 7 + step * (120 + (index % 11)),
    output: 120 + (index % 29) * 3 + step * 17,
    reasoning: index % 4 === 0 ? 40 + step * 9 : step % 3 === 0 ? 15 : 0,
    cache: {
      read: index % 5 === 0 ? 400 + step * 25 : index % 7 === 0 ? 120 : 0,
      write: index % 13 === 0 ? 180 + step * 10 : 0,
    },
  }
}

function baseTokens(index: number): Tokens {
  return {
    input: 700 + (index % 83) * 5,
    output: 90 + (index % 31) * 2,
    reasoning: index % 6 === 0 ? 33 : 0,
    cache: { read: index % 8 === 0 ? 220 : 0, write: index % 17 === 0 ? 75 : 0 },
  }
}

function stepCount(index: number) {
  if (index === 123) return 3
  const mode = index % 20
  if (mode <= 8) return 0
  if (mode <= 14) return 2
  if (mode <= 18) return 5 + (index % 26)
  return 1
}

function createdAt(index: number) {
  const dayOffset = index % 45
  const dayStart = new Date(FIXTURE_NOW - dayOffset * DAY_MS)
  dayStart.setHours(0, 0, 0, 0)
  return dayStart.getTime() + (index % 12) * 60 * 60 * 1000 + (index % 3600) * 1000
}

function costFor(tokens: Tokens, model: (typeof models)[number]) {
  return Math.round(((tokens.input + tokens.cache.write) * model.inputRate + (tokens.output + tokens.reasoning) * model.outputRate + tokens.cache.read * model.inputRate * 0.1) / 1_000_000 * 1_000_000) / 1_000_000
}

export function fixtureSessions() {
  return Array.from({ length: SESSION_COUNT }, (_, index) => {
    const project = projects[Math.floor(index / 3) % projects.length]
    const lineageSlot = index % 3
    const parentID = lineageSlot === 1 ? `ses_fx_${pad(index - 1, 4)}` : lineageSlot === 2 ? `ses_fx_${pad(index - 1, 4)}` : undefined
    return {
      id: `ses_fx_${pad(index, 4)}`,
      projectID: project.id,
      directory: project.worktree,
      title: `Fixture Session ${pad(index, 4)}`,
      parentID,
    }
  })
}

export function fixtureMessages() {
  const sessions = fixtureSessions()
  return Array.from({ length: ROW_COUNT }, (_, index) => {
    const session = sessions[index % sessions.length]
    const model = models[index % models.length]
    const steps = stepCount(index)
    const post = emptyTokens()
    const stepTokenList = Array.from({ length: steps }, (_, step) => stepTokens(index, step + 1))
    for (const item of stepTokenList) addTokens(post, item)
    const pre = steps === 0 ? baseTokens(index) : stepTokenList[stepTokenList.length - 1]
    if (steps === 0) addTokens(post, pre)
    const corrupt = index === 123
    if (corrupt) {
      post.input = pre.input
      post.output = pre.output
      post.reasoning = pre.reasoning
      post.cache = { ...pre.cache }
    }
    return {
      index,
      id: `msg_fx_${pad(index, 5)}`,
      sessionID: session.id,
      session,
      provider: model.provider,
      model: model.model,
      agent: agents[index % agents.length],
      createdAt: createdAt(index),
      completedAt: createdAt(index) + 1_000,
      preTokens: pre,
      postTokens: post,
      cost: costFor(post, model),
      steps,
      corrupt,
      stepTokens: stepTokenList,
    }
  })
}

function toDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function periodStart(period: "today" | "7d" | "30d" | "thisMonth" | "allTime") {
  const date = new Date(FIXTURE_NOW)
  if (period === "allTime") return undefined
  if (period === "today") {
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  if (period === "thisMonth") {
    date.setDate(1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  if (period === "7d") {
    date.setDate(date.getDate() - 6)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return FIXTURE_NOW - 30 * DAY_MS
}

function periodRows(period: "today" | "7d" | "30d" | "thisMonth" | "allTime") {
  const start = periodStart(period)
  return fixtureMessages().filter((row) => start === undefined || row.createdAt >= start)
}

function topID(rows: ReturnType<typeof fixtureMessages>, key: (row: ReturnType<typeof fixtureMessages>[number]) => string) {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + totalTokens(row.postTokens))
  return Array.from(totals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ""
}

function apiEquivalentCost(row: ReturnType<typeof fixtureMessages>[number]) {
  const model = models.find((item) => item.provider === row.provider && item.model === row.model)!
  const cacheWriteRate = row.provider === "openai" ? model.inputRate + model.inputRate : model.inputRate
  return (
    (row.postTokens.input * model.inputRate +
      row.postTokens.output * model.outputRate +
      row.postTokens.reasoning * model.outputRate +
      row.postTokens.cache.read * model.inputRate * 0.1 +
      row.postTokens.cache.write * cacheWriteRate) /
    1_000_000
  )
}

function billableActualCost(row: ReturnType<typeof fixtureMessages>[number]) {
  return row.provider === "opencode" ? 0 : row.cost
}

function providerCalls(row: ReturnType<typeof fixtureMessages>[number]) {
  if (row.corrupt) return 1
  return row.steps > 0 ? row.steps : 1
}

function highImpactResponseID(rows: ReturnType<typeof fixtureMessages>) {
  return (
    rows
      .slice()
      .sort(
        (a, b) =>
          apiEquivalentCost(b) - apiEquivalentCost(a) ||
          billableActualCost(b) - billableActualCost(a) ||
          a.id.localeCompare(b.id),
      )[0]?.id ?? ""
  )
}

function highImpactSessionID(rows: ReturnType<typeof fixtureMessages>) {
  const sessions = new Map<string, { apiEquivalentCost: number; actualCost: number }>()
  for (const row of rows) {
    const session = sessions.get(row.sessionID) ?? { apiEquivalentCost: 0, actualCost: 0 }
    session.apiEquivalentCost += apiEquivalentCost(row)
    session.actualCost += billableActualCost(row)
    sessions.set(row.sessionID, session)
  }
  return (
    Array.from(sessions.entries()).sort(
      ([leftID, left], [rightID, right]) =>
        right.apiEquivalentCost - left.apiEquivalentCost ||
        right.actualCost - left.actualCost ||
        leftID.localeCompare(rightID),
    )[0]?.[0] ?? ""
  )
}

export function analyticsFixtureManifest() {
  const rows = fixtureMessages()
  const rewritten = rows.filter((row) => row.steps >= 2 && !row.corrupt && !sameTokens(row.preTokens, row.postTokens))
  const referenceSession = rows.find((row) => row.steps >= 20 && !row.corrupt)!.sessionID
  const referenceRows = rows.filter((row) => row.sessionID === referenceSession)
  const referencePre = emptyTokens()
  const referencePost = emptyTokens()
  for (const row of referenceRows) {
    addTokens(referencePre, row.preTokens)
    addTokens(referencePost, row.postTokens)
  }
  const periodEntries = Object.fromEntries(
    (["today", "7d", "30d", "thisMonth", "allTime"] as const).map((period) => {
      const scoped = periodRows(period)
      const tokens = emptyTokens()
      let actualCost = 0
      for (const row of scoped) {
        addTokens(tokens, row.postTokens)
        actualCost += row.provider === "opencode" ? 0 : row.cost
      }
      return [
        period,
        {
          calls: scoped.reduce((acc, row) => acc + providerCalls(row), 0),
          sessions: new Set(scoped.map((row) => row.sessionID)).size,
          tokens,
          actualCost: Math.round(actualCost * 1_000_000) / 1_000_000,
          topModel: topID(scoped, (row) => `${row.provider}/${row.model}`),
          topProject: topID(scoped, (row) => row.session.directory),
          topAgent: topID(scoped, (row) => row.agent),
          highImpactSessionID: highImpactSessionID(scoped),
          highImpactResponseID: highImpactResponseID(scoped),
          sampleDay: scoped[0] ? toDay(scoped[0].createdAt) : undefined,
        },
      ]
    }),
  )
  return {
    rowCount: ROW_COUNT,
    rewrittenResponses: rewritten.length,
    skipped: {
      noStepFinish: rows.filter((row) => row.steps === 0).length,
      singleStepFinish: rows.filter((row) => row.steps === 1).length,
      corruptStepFinish: rows.filter((row) => row.corrupt).length,
    },
    filterSamples: {
      project: projects[0].worktree,
      model: `${models[0].provider}/${models[0].model}`,
      agent: agents[0],
      day: toDay(rows[0].createdAt),
      combined: { project: projects[0].worktree, model: `${models[0].provider}/${models[0].model}`, agent: agents[0] },
    },
    referenceSession: {
      sessionID: referenceSession,
      preMigrationTokens: referencePre,
      postMigrationTokens: referencePost,
    },
    periods: periodEntries,
  }
}

export function analyticsPreMigrationManifest() {
  const rows = fixtureMessages()
  return {
    multiStepRows: rows
      .filter((row) => row.steps >= 2)
      .map((row) => ({ messageID: row.id, lastStepOnlyTokens: row.preTokens, postMigrationTokens: row.postTokens })),
  }
}

export const fixtureRates = (provider: string, model: string) => {
  const found = models.find((item) => item.provider === provider && item.model === model)
  if (!found) return undefined
  return { input: found.inputRate, output: found.outputRate, cacheRead: found.inputRate * 0.1, cacheWrite: found.inputRate }
}

export function resetAnalyticsFixture() {
  assertFixtureIsolation()
  AnalyticsStore.rebuild()
  Database.use((db) => {
    db.delete(ProjectTable).run()
  })
}

export function installAnalyticsFixture() {
  assertFixtureIsolation()
  resetAnalyticsFixture()
  const sessions = fixtureSessions()
  const messages = fixtureMessages()
  Database.transaction((db) => {
    for (const project of projects) {
      db.insert(ProjectTable)
        .values({
          id: project.id,
          worktree: project.worktree,
          vcs: "git",
          name: project.name,
          time_created: FIXTURE_NOW,
          time_updated: FIXTURE_NOW,
          sandboxes: [],
        })
        .run()
    }
    for (const session of sessions) {
      db.insert(SessionTable)
        .values({
          id: session.id,
          project_id: session.projectID,
          parent_id: session.parentID,
          slug: session.id,
          directory: session.directory,
          title: session.title,
          version: "fixture",
          time_created: FIXTURE_NOW,
          time_updated: FIXTURE_NOW,
        })
        .run()
    }
    for (const message of messages) {
      db.insert(MessageTable)
        .values({
          id: message.id,
          session_id: message.sessionID,
          time_created: message.createdAt,
          time_updated: message.completedAt,
          data: ({
            role: "assistant",
            parentID: `user_${message.id}`,
            mode: message.agent,
            agent: message.agent,
            path: { cwd: message.session.directory, root: message.session.directory },
            cost: message.cost,
            tokens: message.preTokens,
            modelID: message.model,
            providerID: message.provider,
            finish: "stop",
            time: { created: message.createdAt, completed: message.completedAt },
          } as any),
        })
        .run()
      for (const [stepIndex, tokens] of message.stepTokens.entries()) {
        db.insert(PartTable)
          .values({
            id: `part_fx_${pad(message.index, 5)}_${pad(stepIndex, 2)}`,
            message_id: message.id,
            session_id: message.sessionID,
            time_created: message.createdAt + stepIndex,
            time_updated: message.createdAt + stepIndex,
            data:
              message.corrupt && stepIndex === 1
                ? ({ type: "step-finish", reason: "stop", cost: 0, tokens: { input: "bad" } } as any)
                : ({ type: "step-finish", reason: "stop", cost: costFor(tokens, models[message.index % models.length]), tokens } as any),
          })
          .run()
      }
    }
    db.insert(MessageTable)
      .values({
        id: "msg_fx_placeholder",
        session_id: sessions[0].id,
        time_created: FIXTURE_NOW + 60_000,
        time_updated: FIXTURE_NOW + 60_000,
        data: ({
          role: "assistant",
          parentID: "user_placeholder",
          mode: "build",
          agent: "build",
          path: { cwd: sessions[0].directory, root: sessions[0].directory },
          cost: 0,
          tokens: emptyTokens(),
          modelID: models[0].model,
          providerID: models[0].provider,
          time: { created: FIXTURE_NOW + 60_000 },
        } as any),
      })
      .run()
  })
}

function assertFixtureIsolation() {
  if (process.env["OCO_TEST_PRELOAD"] !== "1") throw new Error("Analytics fixture install requires the test preload marker")
  const dataHome = process.env["XDG_DATA_HOME"] ?? ""
  if (!dataHome.includes("opencode-test-data-")) throw new Error("Analytics fixture install requires an isolated test data directory")
  if (!Database.Path.includes("opencode-test-data-")) throw new Error("Analytics fixture install refused outside isolated test database")
}
