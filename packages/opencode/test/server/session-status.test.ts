// OCO-only file: session status route coverage for project-switch performance.

import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { visibleSessionStatuses } from "../../src/server/routes/session"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..").replaceAll("\\", "/")
Log.init({ print: false })

describe("session.status", () => {
  test("checks only sessions with active statuses", async () => {
    const checked: string[] = []
    const result = await visibleSessionStatuses({
      statuses: {
        existing: { type: "busy" },
        stale: { type: "retry", attempt: 1, message: "wait", next: 2 },
      },
      exists: async (sessionID) => {
        checked.push(sessionID)
        return sessionID === "existing"
      },
    })

    expect(checked.sort()).toEqual(["existing", "stale"])
    expect(result).toEqual({ existing: { type: "busy" } })
  })

  test("checks active status existence in parallel", async () => {
    const started: string[] = []
    let release!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve
    })

    const resultPromise = visibleSessionStatuses({
      statuses: {
        first: { type: "busy" },
        second: { type: "busy" },
      },
      exists: async (sessionID) => {
        started.push(sessionID)
        if (started.length === 2) release()
        await bothStarted
        return sessionID === "first"
      },
    })

    await Promise.race([
      bothStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("status checks were serial")), 100)),
    ])
    await expect(resultPromise).resolves.toEqual({ first: { type: "busy" } })
    expect(started.sort()).toEqual(["first", "second"])
  })

  test("does not hit storage when there are no active statuses", async () => {
    let checked = 0
    const result = await visibleSessionStatuses({
      statuses: {},
      exists: async () => {
        checked += 1
        return true
      },
    })

    expect(checked).toBe(0)
    expect(result).toEqual({})
  })

  test("route returns active statuses for the current directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})
        const staleSessionID = "ses_missing_status"
        SessionStatus.set(session.id, { type: "busy" })
        SessionStatus.set(staleSessionID, { type: "busy" })

        try {
          const response = await app.request("/session/status", {
            headers: { "x-opencode-directory": projectRoot },
          })
          expect(response.status).toBe(200)
          const body = (await response.json()) as Record<string, unknown>
          expect(body[session.id]).toEqual({ type: "busy" })
          expect(body[staleSessionID]).toBeUndefined()
        } finally {
          SessionStatus.set(session.id, { type: "idle" })
          SessionStatus.set(staleSessionID, { type: "idle" })
          await Session.remove(session.id)
        }
      },
    })
  }, 10000)
})

describe("session.list", () => {
  test("preserves ordering, limit, and metadata while loading metadata concurrently", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const older = await Session.create({ title: "older", agentID: "build", async: true })
        await Bun.sleep(5)
        const middle = await Session.create({ title: "middle", agentID: "plan" })
        await Bun.sleep(5)
        const newer = await Session.create({ title: "newer", async: true })

        try {
          const response = await Server.App().request("/session?limit=2", {
            headers: { "x-opencode-directory": tmp.path },
          })
          expect(response.status).toBe(200)
          const listed = (await response.json()) as Session.Info[]

          expect(listed.map((session) => session.id)).toEqual([newer.id, middle.id])
          expect(listed.map((session) => session.title)).toEqual(["newer", "middle"])
          expect(listed.map((session) => session.agentID)).toEqual([undefined, "plan"])
          expect(listed.map((session) => session.async)).toEqual([true, undefined])
        } finally {
          await Session.remove(newer.id)
          await Session.remove(middle.id)
          await Session.remove(older.id)
        }
      },
    })
  }, 10000)
})
