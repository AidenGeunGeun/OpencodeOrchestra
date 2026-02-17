import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { Database, and, eq, sql } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { work } from "../util/queue"
import { fn } from "@opencode-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { git } from "../util/git"

export namespace Project {
  const log = Log.create({ service: "project" })
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined

    return {
      id: row.id,
      worktree: row.worktree,
      vcs: row.vcs ? Info.shape.vcs.parse(row.vcs) : undefined,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  function updateSet(project: Info) {
    return {
      worktree: project.worktree,
      vcs: project.vcs ?? null,
      name: project.name,
      icon_url: project.icon?.url,
      icon_color: project.icon?.color,
      time_updated: project.time.updated,
      time_initialized: project.time.initialized,
      sandboxes: project.sandboxes,
      commands: project.commands,
    }
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const data = await iife(async () => {
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const dotgit = await matches.next().then((x) => x.value)
      await matches.return()

      if (dotgit) {
        let sandbox = path.dirname(dotgit)

        const gitBinary = Bun.which("git")

        // cached id calculation
        let id = await Bun.file(path.join(dotgit, "opencode"))
          .text()
          .then((x) => x.trim())
          .catch(() => undefined)

        if (!gitBinary) {
          return {
            id: id ?? "global",
            worktree: sandbox,
            sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        // generate id from root commit
        if (!id) {
          const roots = await git(["rev-list", "--max-parents=0", "--all"], {
            cwd: sandbox,
          })
            .then(async (result) =>
              (await result.text())
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
            .catch(() => undefined)

          if (!roots) {
            return {
              id: "global",
              worktree: sandbox,
              sandbox,
              vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
            }
          }

          id = roots[0]
          if (id) {
            void Bun.file(path.join(dotgit, "opencode"))
              .write(id)
              .catch(() => undefined)
          }
        }

        if (!id) {
          return {
            id: "global",
            worktree: sandbox,
            sandbox,
            vcs: "git",
          }
        }

        const top = await git(["rev-parse", "--show-toplevel"], {
          cwd: sandbox,
        })
          .then(async (result) => path.resolve(sandbox, (await result.text()).trim()).replaceAll("\\", "/"))
          .catch(() => undefined)

        if (!top) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        sandbox = top

        const worktree = await git(["rev-parse", "--git-common-dir"], {
          cwd: sandbox,
        })
          .then(async (result) => {
            const dirname = path.dirname((await result.text()).trim().replaceAll("\\", "/"))
            if (dirname === ".") return sandbox
            return dirname
          })
          .catch(() => undefined)

        if (!worktree) {
          return {
            id,
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
          }
        }

        return {
          id,
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.OPENCODE_FAKE_VCS),
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing: Info = row
      ? fromRow(row)
      : {
          id: data.id,
          worktree: data.worktree,
          vcs: data.vcs as Info["vcs"],
          sandboxes: [],
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        }

    if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      vcs: data.vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox)) {
      result.sandboxes.push(data.sandbox)
    }
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))

    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: result.id,
          ...updateSet(result),
          time_created: result.time.created,
        })
        .onConflictDoUpdate({ target: ProjectTable.id, set: updateSet(result) })
        .run(),
    )

    if (!row && result.id !== "global") {
      await migrateSessions(result.id, result.worktree)
    }

    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree,
        absolute: true,
        onlyFiles: true,
        followSymlinks: false,
        dot: false,
      }),
    )
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = file.type || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateSessions(projectID: string, worktree: string) {
    const normalizedWorktree = path.resolve(worktree).replaceAll("\\", "/")
    if (normalizedWorktree === "/") return

    const inWorktree = sql`(
      replace(${SessionTable.directory}, '\\', '/') = ${normalizedWorktree}
      OR replace(${SessionTable.directory}, '\\', '/') LIKE ${`${normalizedWorktree}/%`}
    )`

    const sessions = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(sql`${SessionTable.project_id} <> ${projectID}`, inWorktree))
        .all(),
    )

    if (sessions.length === 0) return

    log.info("migrating sessions to project", { projectID, worktree, count: sessions.length })

    await work(10, sessions, async (row) => {
      log.info("migrating session", { sessionID: row.id, from: row.project_id, to: projectID })
      Database.use((db) => db.update(SessionTable).set({ project_id: projectID }).where(eq(SessionTable.id, row.id)).run())
    }).catch((error) => {
      log.error("failed to migrate sessions to project", { error, projectID })
    })
  }

  export function setInitialized(id: string) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => {
          const project = fromRow(row)
          project.sandboxes = project.sandboxes.filter((x) => existsSync(x))
          return project
        }),
    )
  }

  export function get(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const result = Database.use((db) => {
        const existing = db.select().from(ProjectTable).where(eq(ProjectTable.id, input.projectID)).get()
        if (!existing) throw new Error(`Project not found: ${input.projectID}`)

        const draft = fromRow(existing)

        if (input.name !== undefined) draft.name = input.name
        if (input.icon !== undefined) {
          draft.icon = {
            ...draft.icon,
          }
          if (input.icon.url !== undefined) draft.icon.url = input.icon.url
          if (input.icon.override !== undefined) draft.icon.override = input.icon.override || undefined
          if (input.icon.color !== undefined) draft.icon.color = input.icon.color
        }

        if (input.commands?.start !== undefined) {
          const start = input.commands.start || undefined
          draft.commands = {
            ...(draft.commands ?? {}),
          }
          draft.commands.start = start
          if (!draft.commands.start) draft.commands = undefined
        }

        draft.time.updated = Date.now()

        const row = db
          .update(ProjectTable)
          .set(updateSet(draft))
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get()
        if (!row) throw new Error(`Project not found: ${input.projectID}`)

        return fromRow(row)
      })

      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: result,
        },
      })
      return result
    },
  )

  export async function sandboxes(id: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []

    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const stat = await Bun.file(dir)
        .stat()
        .catch(() => undefined)
      if (stat?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)

    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)

    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)

    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)

    const sandboxes = row.sandboxes.filter((sandbox) => sandbox !== directory)

    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)

    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
