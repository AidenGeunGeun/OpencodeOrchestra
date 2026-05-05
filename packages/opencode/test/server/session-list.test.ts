import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { raw } from "#db"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, inArray } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.list", () => {
  test("filters by directory", async () => {
    const normalizedProjectRoot = projectRoot.replaceAll("\\", "/")
    await Instance.provide({
      directory: normalizedProjectRoot,
      fn: async () => {
        const app = Server.App()

        const first = await Session.create({})

        const otherDir = path.join(normalizedProjectRoot, "..", "__session_list_other").replaceAll("\\", "/")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        try {
          const response = await app.request(`/session?directory=${encodeURIComponent(normalizedProjectRoot)}`)
          expect(response.status).toBe(200)

          const body = (await response.json()) as unknown[]
          const ids = body
            .map((s) => (typeof s === "object" && s && "id" in s ? (s as { id: string }).id : undefined))
            .filter((x): x is string => typeof x === "string")

          expect(ids).toContain(first.id)
          expect(ids).not.toContain(second.id)
        } finally {
          await Session.remove(first.id)
          await Instance.provide({
            directory: otherDir,
            fn: async () => Session.remove(second.id),
          })
        }
      },
    })
  }, 10000)

  test("rejects non-positive limits", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const response = await Server.App().request("/session?limit=-1", {
          headers: { "x-opencode-directory": projectRoot },
        })
        expect(response.status).toBe(400)
      },
    })
  }, 10000)

  test("uses directory recent index and scales with requested rows", async () => {
    const projects = [] as Awaited<ReturnType<typeof tmpdir>>[]
    for (let index = 0; index < 25; index++) projects.push(await tmpdir({ git: true }))

    const ids: string[] = []
    const projectIDs: string[] = []
    const directories: { projectID: string; worktree: string; listDirectory: string }[] = []
    const missingDirectories: string[] = []
    let activeSessionID = ""
    const rows: (typeof SessionTable.$inferInsert)[] = []
    const now = Date.now()

    try {
      for (const [projectIndex, project] of projects.entries()) {
        await Instance.provide({
          directory: project.path,
          fn: async () => {
            const projectID = Instance.project.id
            const listDirectory = project.path
            projectIDs.push(projectID)
            directories.push({ projectID, worktree: project.path, listDirectory })
            if (projectIndex < 5) missingDirectories.push(path.join(project.path, "moved-away").replaceAll("\\", "/"))

            const parentIDs: string[] = []
            for (let sessionIndex = 0; sessionIndex < 100; sessionIndex++) {
              const child = sessionIndex % 10 === 9
              const parentID = child ? parentIDs.at(-1) : undefined
              const id = Identifier.ascending("session")
              ids.push(id)
              if (!child) parentIDs.push(id)
              if (projectIndex === 0 && sessionIndex === 98) activeSessionID = id
              rows.push({
                id,
                project_id: projectID,
                workspace_id: null,
                parent_id: parentID,
                slug: `perf-${projectIndex}-${sessionIndex}`,
                directory: listDirectory,
                title: `Perf ${projectIndex} ${sessionIndex}`,
                version: "test",
                time_created: now - projectIndex * 1000 - sessionIndex,
                time_updated: now - projectIndex * 1000 - sessionIndex,
                time_archived: sessionIndex % 5 === 0 ? now - sessionIndex : null,
              })
            }
          },
        })
      }

      expect(new Set(projectIDs).size).toBe(25)
      expect(rows).toHaveLength(2500)
      expect(rows.filter((row) => row.parent_id).length).toBe(250)
      expect(rows.filter((row) => row.time_archived !== null && row.time_archived !== undefined).length).toBe(500)
      expect(missingDirectories).toHaveLength(5)

      Database.use((db) => {
        for (let index = 0; index < rows.length; index += 250) {
          db.insert(SessionTable)
            .values(rows.slice(index, index + 250))
            .run()
        }
      })

      const app = Server.App()
      const requestedPaths: string[] = []
      const request = (target: string, init?: RequestInit) => {
        requestedPaths.push(target)
        return app.request(target, init)
      }
      const spawnSpy = spyOn(Bun, "spawn")

      try {
        const first = directories[0]
        const plan = raw(Database.Client())
          .query(
            "EXPLAIN QUERY PLAN SELECT id FROM session WHERE project_id = ? AND workspace_id IS NULL AND directory = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT ?",
          )
          .all(first.projectID, first.listDirectory, 25) as { detail: string }[]
        expect(plan.map((row) => row.detail).join("\n")).toContain("session_directory_recent_idx")

        await Instance.provide({
          directory: first.worktree,
          fn: async () => {
            const listed = await Session.listWithStats({ directory: first.listDirectory, roots: true, limit: 25 })
            expect(listed.sessions).toHaveLength(25)
            expect(listed.stats.rows).toBe(25)
            expect(listed.stats.limit).toBe(25)
            expect(listed.stats.metadataReads).toBe(0)
            expect(listed.sessions.some((session) => session.id === activeSessionID)).toBe(false)

            const [low, high] = await Promise.all([
              Session.listWithStats({ directory: first.listDirectory, roots: true, limit: 5 }),
              Session.listWithStats({ directory: first.listDirectory, roots: true, limit: 40 }),
            ])
            expect(low.sessions).toHaveLength(5)
            expect(high.sessions).toHaveLength(40)
          },
        })

        for (const directory of directories) {
          const response = await request(
            `/session?directory=${encodeURIComponent(directory.listDirectory)}&roots=true&limit=25`,
          )
          expect(response.status).toBe(200)
        }

        const missing = await Instance.provide({
          directory: directories[0].worktree,
          fn: async () => Session.listWithStats({ directory: missingDirectories[0], roots: true, limit: 25 }),
        })
        expect(missing.sessions).toHaveLength(0)

        const response = await request(`/session/${activeSessionID}`, {
          headers: { "x-opencode-directory": first.worktree },
        })
        expect(response.status).toBe(200)
        const restored = (await response.json()) as Session.Info
        expect(restored.id).toBe(activeSessionID)

        const packageManagerCalls = spawnSpy.mock.calls.filter((call) => {
          const input = call[0] as unknown
          const command = Array.isArray(input)
            ? input.map(String)
            : typeof input === "object" && input && "cmd" in input && Array.isArray((input as { cmd?: unknown }).cmd)
              ? ((input as { cmd: unknown[] }).cmd).map(String)
              : []
          return (
            command.some((part) => /(^|\/)bun$/.test(part)) &&
            command.some((part) => part === "add" || part === "install")
          )
        })
        expect(packageManagerCalls).toHaveLength(0)
        expect(requestedPaths.filter((target) => target.includes("/analytics"))).toHaveLength(0)
      } finally {
        spawnSpy.mockRestore()
      }
    } finally {
      Database.use((db) => {
        for (let index = 0; index < ids.length; index += 250) {
          db.delete(SessionTable)
            .where(inArray(SessionTable.id, ids.slice(index, index + 250)))
            .run()
        }
        db.delete(ProjectTable).where(inArray(ProjectTable.id, projectIDs)).run()
      })
    }
  }, 20000)
})
