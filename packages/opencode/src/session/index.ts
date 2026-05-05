import { Slug } from "@opencode-ai/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type LanguageModelUsage, type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Identifier } from "../id/id"
import { Installation } from "../installation"

import { Database, NotFoundError, and, desc, eq, isNull, like, sql } from "../storage/db"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"

import type { Provider } from "@/provider/provider"
import { PermissionNext } from "@/permission/next"
import { Global } from "@/global"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { SecretRedaction } from "@/secret/redaction"

export namespace Session {
  const log = Log.create({ service: "session" })

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  function sessionAgentKey(sessionID: string) {
    return ["session_agent", Instance.project.id, sessionID]
  }

  function sessionAsyncKey(sessionID: string) {
    return ["session_async", Instance.project.id, sessionID]
  }

  type SideMetadataKind = "agent" | "async"

  type SideMetadataCache = {
    projectID: string
    agentIDs: Set<string>
    asyncIDs: Set<string>
    agent: Map<string, string | undefined>
    async: Map<string, boolean | undefined>
    files: number
  }

  const sideMetadataCaches = new Map<string, Promise<SideMetadataCache>>()
  const maxSideMetadataCaches = 32

  async function readSideMetadata<T>(key: string[]) {
    return Storage.read<T>(key).catch(() => undefined)
  }

  async function loadSideMetadataCache(projectID: string): Promise<SideMetadataCache> {
    const [agentKeys, asyncKeys] = await Promise.all([
      Storage.list(["session_agent", projectID]),
      Storage.list(["session_async", projectID]),
    ])
    const agentIDs = new Set<string>()
    const asyncIDs = new Set<string>()
    const agent = new Map<string, string>()
    const async = new Map<string, boolean>()

    for (const key of agentKeys) {
      const sessionID = key.at(-1)
      if (sessionID) agentIDs.add(sessionID)
    }
    for (const key of asyncKeys) {
      const sessionID = key.at(-1)
      if (sessionID) asyncIDs.add(sessionID)
    }

    return {
      projectID,
      agentIDs,
      asyncIDs,
      agent,
      async,
      files: agentKeys.length + asyncKeys.length,
    }
  }

  async function hydrateSideMetadata(cache: SideMetadataCache, sessionIDs: string[]) {
    let reads = 0
    await Promise.all(
      sessionIDs.map(async (sessionID) => {
        if (cache.agentIDs.has(sessionID) && !cache.agent.has(sessionID)) {
          reads++
          const value = await readSideMetadata<string>(sessionAgentKey(sessionID))
          cache.agent.set(sessionID, value)
        }
        if (cache.asyncIDs.has(sessionID) && !cache.async.has(sessionID)) {
          reads++
          const value = await readSideMetadata<boolean>(sessionAsyncKey(sessionID))
          cache.async.set(sessionID, value)
        }
      }),
    )
    return reads
  }

  function getSideMetadataCache() {
    const projectID = Instance.project.id
    const cache = sideMetadataCaches.get(projectID)
    if (cache) {
      sideMetadataCaches.delete(projectID)
      sideMetadataCaches.set(projectID, cache)
      return { hit: true, promise: cache }
    }

    const promise = loadSideMetadataCache(projectID).catch((error) => {
      if (sideMetadataCaches.get(projectID) === promise) sideMetadataCaches.delete(projectID)
      throw error
    })
    sideMetadataCaches.set(projectID, promise)
    while (sideMetadataCaches.size > maxSideMetadataCaches) {
      const oldest = sideMetadataCaches.keys().next().value
      if (!oldest) break
      sideMetadataCaches.delete(oldest)
    }
    return { hit: false, promise }
  }

  function updateSideMetadataCache(kind: SideMetadataKind, sessionID: string, value: string | boolean | undefined) {
    const cache = sideMetadataCaches.get(Instance.project.id)
    if (!cache) return
    cache
      .then((metadata) => {
        if (kind === "agent") {
          if (typeof value === "string") {
            metadata.agentIDs.add(sessionID)
            metadata.agent.set(sessionID, value)
          } else {
            metadata.agentIDs.delete(sessionID)
            metadata.agent.delete(sessionID)
          }
          return
        }
        if (typeof value === "boolean") {
          metadata.asyncIDs.add(sessionID)
          metadata.async.set(sessionID, value)
        } else {
          metadata.asyncIDs.delete(sessionID)
          metadata.async.delete(sessionID)
        }
      })
      .catch(() => {})
  }

  async function getAgentID(sessionID: string) {
    return readSideMetadata<string>(sessionAgentKey(sessionID))
  }

  async function getAsync(sessionID: string) {
    return readSideMetadata<boolean>(sessionAsyncKey(sessionID))
  }

  async function setAgentID(sessionID: string, agentID: string | undefined) {
    if (agentID) {
      await Storage.write(sessionAgentKey(sessionID), agentID)
      updateSideMetadataCache("agent", sessionID, agentID)
      return
    }
    await Storage.remove(sessionAgentKey(sessionID)).catch(() => {})
    updateSideMetadataCache("agent", sessionID, undefined)
  }

  async function setAsync(sessionID: string, value: boolean | undefined) {
    if (value) {
      await Storage.write(sessionAsyncKey(sessionID), value)
      updateSideMetadataCache("async", sessionID, value)
      return
    }
    await Storage.remove(sessionAsyncKey(sessionID)).catch(() => {})
    updateSideMetadataCache("async", sessionID, undefined)
  }

  function scopedConditions() {
    const conditions = [eq(SessionTable.project_id, Instance.project.id)]
    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    } else {
      conditions.push(isNull(SessionTable.workspace_id))
    }
    return conditions
  }

  function scopedID(id: string) {
    return and(eq(SessionTable.id, id), ...scopedConditions())
  }

  function getToolStateMetadata(part: MessageV2.ToolPart) {
    if (part.state.status === "pending") return undefined
    return part.state.metadata
  }

  function getTaskSessionID(part: MessageV2.ToolPart) {
    const metadata = getToolStateMetadata(part)
    return typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
  }

  function remapReferenceString(value: string, idMap: Map<string, string>) {
    let result = value
    for (const [source, target] of idMap) {
      result = result.split(source).join(target)
    }
    return result
  }

  function remapSessionReferences<T>(value: T, idMap: Map<string, string>): T {
    if (typeof value === "string") return remapReferenceString(value, idMap) as T
    if (Array.isArray(value)) return value.map((item) => remapSessionReferences(item, idMap)) as T
    if (!value || typeof value !== "object") return value

    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = remapSessionReferences(child, idMap)
    }
    return result as T
  }

  function remapPartSessionReferences(part: MessageV2.Part, idMap: Map<string, string>): MessageV2.Part {
    if (part.type !== "tool" || idMap.size === 0) return part

    const cloned = structuredClone(part)
    const state = cloned.state
    if ("metadata" in state && state.metadata) {
      state.metadata = remapSessionReferences(state.metadata, idMap)
    }
    if ("output" in state && typeof state.output === "string") {
      state.output = remapReferenceString(state.output, idMap)
    }
    if (cloned.metadata) {
      cloned.metadata = remapSessionReferences(cloned.metadata, idMap)
    }
    return cloned
  }

  function toolIDsByMessage(messages: MessageV2.WithParts[]) {
    const result = new Map<string, string[]>()
    for (const message of messages) {
      const ids = message.parts
        .filter((part): part is MessageV2.ToolPart => part.type === "tool")
        .map((part) => part.callID)
        .filter((id, index, list) => list.indexOf(id) === index)
      if (ids.length > 0) result.set(message.info.id, ids)
    }
    return result
  }

  function referencedChildSessionIDs(messages: MessageV2.WithParts[], directChildIDs: Set<string>) {
    const result = new Set<string>()
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool") continue
        const childSessionID = getTaskSessionID(part)
        if (!childSessionID || !directChildIDs.has(childSessionID)) continue
        result.add(childSessionID)
      }
    }
    return result
  }

  function recordFromMap<T>(map: Map<string, T>) {
    return Object.fromEntries(map) as Record<string, T>
  }

  function getForkCutoffTime(messages: MessageV2.WithParts[], messageID: string | undefined) {
    if (!messageID) return undefined
    return messages.find((msg) => msg.info.id >= messageID)?.info.time.created
  }

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined

    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      workspaceID: row.workspace_id ?? undefined,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
    }
  }

  function toRow(info: Info): typeof SessionTable.$inferInsert {
    return {
      id: info.id,
      project_id: info.projectID,
      workspace_id: info.workspaceID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
    }
  }

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      slug: z.string(),
      projectID: z.string(),
      workspaceID: z.string().optional(),
      directory: z.string(),
      parentID: Identifier.schema("session").optional(),
      // OpenCodeOrchestra: Store agent type for subagent sessions
      agentID: z.string().optional(),
      async: z.boolean().optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: z.string(),
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ShareInfo = z
    .object({
      secret: z.string(),
      url: z.string(),
    })
    .meta({
      ref: "SessionShare",
    })
  export type ShareInfo = z.output<typeof ShareInfo>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: Identifier.schema("session").optional(),
        agentID: z.string().optional(), // OpenCodeOrchestra: Store agent type for subagent sessions
        async: z.boolean().optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        agentID: input?.agentID, // OpenCodeOrchestra: Pass agent type
        async: input?.async,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      const session = await createNext({
        directory: Instance.directory,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const copiedRootMessages = msgs.filter((msg) => !input.messageID || msg.info.id < input.messageID)
      const cutoffTime = getForkCutoffTime(msgs, input.messageID)
      const childSessions = await forkChildSessions(input.sessionID, copiedRootMessages, input.messageID, cutoffTime)
      const sessionIDMap = new Map<string, string>([[input.sessionID, session.id]])

      for (const child of childSessions) {
        const parentID = child.parentID ? sessionIDMap.get(child.parentID) : undefined
        if (!parentID) continue
        const cloned = await createNext({
          directory: child.directory,
          parentID,
          agentID: child.agentID,
          async: child.async,
          title: child.title,
          permission: child.permission,
        })
        sessionIDMap.set(child.id, cloned.id)
      }

      const rootClone = await cloneSessionMessages({
        sourceSessionID: input.sessionID,
        targetSessionID: session.id,
        sourceMessages: msgs,
        beforeMessageID: input.messageID,
        sessionIDMap,
      })

      for (const child of childSessions) {
        const targetSessionID = sessionIDMap.get(child.id)
        if (!targetSessionID) continue
        await cloneSessionMessages({
          sourceSessionID: child.id,
          targetSessionID,
          beforeTime: cutoffTime,
          sessionIDMap,
        })
      }

      await triggerForkHook({
        sourceSessionID: input.sessionID,
        targetSessionID: session.id,
        cutoffMessageID: input.messageID,
        messageIDMap: recordFromMap(rootClone.messageIDMap),
        toolIDsByMessageID: recordFromMap(rootClone.toolIDsByMessageID),
        childSessionIDMap: recordFromMap(new Map([...sessionIDMap].filter(([source]) => source !== input.sessionID))),
      })
      return session
    },
  )

  async function forkChildSessions(
    sourceSessionID: string,
    copiedRootMessages: MessageV2.WithParts[],
    cutoffMessageID: string | undefined,
    cutoffTime: number | undefined,
  ) {
    const inCutoff = (session: Info) => cutoffTime === undefined || session.time.created < cutoffTime
    const directChildren = (await children(sourceSessionID)).filter((child) => !child.time.archived && inCutoff(child))
    if (directChildren.length === 0) return []

    let selectedDirectChildren = directChildren
    if (cutoffMessageID) {
      const directChildIDs = new Set(directChildren.map((child) => child.id))
      const referenced = referencedChildSessionIDs(copiedRootMessages, directChildIDs)
      if (referenced.size > 0) {
        selectedDirectChildren = directChildren.filter((child) => referenced.has(child.id))
      } else {
        selectedDirectChildren = cutoffTime !== undefined ? directChildren : []
      }
    }

    const result: Info[] = []
    const seen = new Set<string>()
    const queue = [...selectedDirectChildren]
    while (queue.length > 0) {
      const child = queue.shift()!
      if (seen.has(child.id)) continue
      seen.add(child.id)
      result.push(child)
      queue.push(...(await children(child.id)).filter((nested) => !nested.time.archived && inCutoff(nested)))
    }
    return result
  }

  async function cloneSessionMessages(input: {
    sourceSessionID: string
    targetSessionID: string
    sourceMessages?: MessageV2.WithParts[]
    beforeMessageID?: string
    beforeTime?: number
    sessionIDMap: Map<string, string>
  }) {
    const sourceMessages = input.sourceMessages ?? (await messages({ sessionID: input.sourceSessionID }))
    const messageIDMap = new Map<string, string>()
    const copiedMessages: MessageV2.WithParts[] = []

    for (const msg of sourceMessages) {
      if (input.beforeMessageID && msg.info.id >= input.beforeMessageID) break
      if (input.beforeTime !== undefined && msg.info.time.created >= input.beforeTime) break
      const newID = Identifier.ascending("message")
      messageIDMap.set(msg.info.id, newID)
      copiedMessages.push(msg)

      const clonedInfo = structuredClone(msg.info)
      clonedInfo.id = newID
      clonedInfo.sessionID = input.targetSessionID
      if (clonedInfo.role === "assistant") {
        clonedInfo.parentID = messageIDMap.get(clonedInfo.parentID) ?? clonedInfo.parentID
      }
      const cloned = await updateMessage(clonedInfo)

      for (const sourcePart of msg.parts) {
        const part = remapPartSessionReferences(sourcePart, input.sessionIDMap)
        await updatePart({
          ...part,
          id: Identifier.ascending("part"),
          messageID: cloned.id,
          sessionID: input.targetSessionID,
        })
      }
    }

    return {
      messageIDMap,
      toolIDsByMessageID: toolIDsByMessage(copiedMessages),
    }
  }

  async function triggerForkHook(input: {
    sourceSessionID: string
    targetSessionID: string
    cutoffMessageID?: string
    messageIDMap: Record<string, string>
    toolIDsByMessageID: Record<string, string[]>
    childSessionIDMap: Record<string, string>
  }) {
    try {
      const { Plugin } = await import("../plugin")
      await Plugin.trigger("session.fork", input, {})
    } catch (error) {
      log.warn("fork plugin hook failed", { error })
    }
  }

  export const touch = fn(Identifier.schema("session"), async (sessionID) => {
    await update(sessionID, (draft) => {
      draft.time.updated = Date.now()
    })
  })

  export async function createNext(input: {
    id?: string
    title?: string
    parentID?: string
    agentID?: string // OpenCodeOrchestra: Store agent type for subagent sessions
    async?: boolean
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    const result: Info = {
      id: Identifier.descending("session", input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      workspaceID: WorkspaceContext.workspaceID,
      directory: input.directory,
      parentID: input.parentID,
      agentID: input.agentID, // OpenCodeOrchestra: Store agent type
      async: input.async,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    await setAgentID(result.id, result.agentID)
    await setAsync(result.id, result.async)
    const cfg = await Config.get()
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch(() => {
        // Silently ignore sharing errors during session creation
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, Global.Namespace.projectDir, "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const get = fn(Identifier.schema("session"), async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(scopedID(id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    const info = fromRow(row)
    info.agentID = await getAgentID(id)
    info.async = await getAsync(id)
    return info
  })

  // OCO: status visibility can check scoped existence without metadata hydration.
  export const exists = fn(Identifier.schema("session"), async (id) => {
    return Database.use((db) => !!db.select({ id: SessionTable.id }).from(SessionTable).where(scopedID(id)).get())
  })

  export const getShare = fn(Identifier.schema("session"), async (id) => {
    return Storage.read<ShareInfo>(["share", id])
  })

  export const share = fn(Identifier.schema("session"), async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: share.url }).where(scopedID(id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(async () => {
        info.agentID = await getAgentID(id)
        info.async = await getAsync(id)
        Bus.publish(Event.Updated, { info })
      })
    })
    return share
  })

  export const unshare = fn(Identifier.schema("session"), async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: null }).where(scopedID(id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(async () => {
        info.agentID = await getAgentID(id)
        info.async = await getAsync(id)
        Bus.publish(Event.Updated, { info })
      })
    })
  })

  export async function update(id: string, editor: (session: Info) => void, options?: { touch?: boolean }) {
    const existingAgentID = await getAgentID(id)
    const existingAsync = await getAsync(id)
    const result = Database.use((db) => {
      const existing = db.select().from(SessionTable).where(scopedID(id)).get()
      if (!existing) throw new NotFoundError({ message: `Session not found: ${id}` })

      const draft = fromRow(existing)
      draft.agentID = existingAgentID
      draft.async = existingAsync
      editor(draft)
      if (options?.touch !== false) {
        draft.time.updated = Date.now()
      }

      const row = db.update(SessionTable).set(toRow(draft)).where(scopedID(id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      info.agentID = draft.agentID
      info.async = draft.async
      updateSideMetadataCache("agent", id, draft.agentID)
      updateSideMetadataCache("async", id, draft.async)
      Database.effect(async () => {
        await setAgentID(id, draft.agentID)
        await setAsync(id, draft.async)
        Bus.publish(Event.Updated, {
          info,
        })
      })
      return info
    })

    return result
  }

  export const setTitle = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      title: z.string(),
    }),
    async (input) => {
      return update(input.sessionID, (draft) => {
        draft.title = input.title
      })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      time: z.number().optional(),
    }),
    async (input) => {
      return update(
        input.sessionID,
        (draft) => {
          draft.time.archived = input.time
        },
        { touch: false },
      )
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      return update(input.sessionID, (draft) => {
        draft.permission = input.permission
      })
    },
  )

  export const setRevert = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return update(input.sessionID, (draft) => {
        draft.revert = input.revert
        draft.summary = input.summary
      })
    },
  )

  export const clearRevert = fn(Identifier.schema("session"), async (sessionID) => {
    return update(sessionID, (draft) => {
      draft.revert = undefined
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      summary: Info.shape.summary,
    }),
    async (input) => {
      return update(input.sessionID, (draft) => {
        draft.summary = input.summary
      })
    },
  )

  export const diff = fn(Identifier.schema("session"), async (sessionID) => {
    const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    return diffs ?? []
  })

  export const messages = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      limit: z.number().optional(),
    }),
    async (input) => {
      await get(input.sessionID)
      const result = [] as MessageV2.WithParts[]
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export type ListInput = {
    directory?: string
    workspaceID?: string
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }

  export type ListStats = {
    rows: number
    limit: number
    queryMs: number
    metadataMs: number
    metadataCacheHit: boolean
    metadataReadMode: "project-sidecar-cache"
    metadataReads: number
    metadataFiles: number
  }

  export async function listWithStats(input?: ListInput) {
    const conditions = scopedConditions()

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start !== undefined) {
      conditions.push(sql`${SessionTable.time_updated} >= ${input.start}`)
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }

    const limit = Math.max(1, Math.floor(input?.limit ?? 100))

    const queryStart = performance.now()
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    const queryMs = performance.now() - queryStart

    const metadataStart = performance.now()
    // OCO: avoid per-row sidecar misses during desktop session warmup.
    const metadata = getSideMetadataCache()
    const side = await metadata.promise
    const metadataReads = await hydrateSideMetadata(
      side,
      rows.map((row) => row.id),
    )
    const metadataMs = performance.now() - metadataStart
    const infos = rows.map((row) => {
      const info = fromRow(row)
      info.agentID = side.agent.get(info.id)
      info.async = side.async.get(info.id)
      return info
    })

    return {
      sessions: infos,
      stats: {
        rows: infos.length,
        limit,
        queryMs,
        metadataMs,
        metadataCacheHit: metadata.hit,
        metadataReadMode: "project-sidecar-cache" as const,
        metadataReads,
        metadataFiles: side.files,
      } satisfies ListStats,
    }
  }

  export async function* list(input?: ListInput) {
    const result = await listWithStats(input)
    for (const info of result.sessions) {
      yield info
    }
  }

  export const children = fn(Identifier.schema("session"), async (parentID) => {
    const conditions = [...scopedConditions(), eq(SessionTable.parent_id, parentID)]
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .all(),
    )
    const result = [] as Session.Info[]
    for (const row of rows) {
      const info = fromRow(row)
      info.agentID = await getAgentID(info.id)
      info.async = await getAsync(info.id)
      result.push(info)
    }
    return result
  })

  export const remove = fn(Identifier.schema("session"), async (sessionID) => {
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        const waitForChildExit = SessionPrompt.wait(child.id)
        SessionPrompt.cancel(child.id, { cascadeAsyncChildren: false })
        if (waitForChildExit) {
          await waitForChildExit
        }
        await remove(child.id)
      }
      await unshare(sessionID).catch(() => {})
      Database.use((db) => {
        db.delete(SessionTable).where(scopedID(sessionID)).run()
        Database.effect(() =>
          Bus.publish(Event.Deleted, {
            info: session,
          }),
        )
      })
      await setAgentID(sessionID, undefined)
      await setAsync(sessionID, undefined)
    } catch (e) {
      log.error(e)
    }
  })

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(MessageV2.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(MessageV2.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part"),
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(
            and(
              eq(PartTable.id, input.partID),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.session_id, input.sessionID),
            ),
          )
          .run()
        Database.effect(() =>
          Bus.publish(MessageV2.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = z.union([
    MessageV2.Part,
    z.object({
      part: MessageV2.TextPart,
      delta: z.string(),
    }),
    z.object({
      part: MessageV2.ReasoningPart,
      delta: z.string(),
    }),
  ])

  export const updatePart = fn(UpdatePartInput, async (input) => {
    const originalPart = "delta" in input ? input.part : input
    const patterns = await SecretRedaction.patternsForSession(originalPart.sessionID)
    const part = SecretRedaction.applyUnknown(originalPart, patterns)
    const delta = "delta" in input ? SecretRedaction.applyUnknown(input.delta, patterns) : undefined
    const { id, messageID, sessionID, ...data } = part
    const time_created = Date.now()
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(MessageV2.Event.PartUpdated, {
          part: structuredClone(part),
          delta,
        }),
      )
    })
    return part
  })

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const normalizeTokenCount = (val: unknown): number => {
        if (typeof val === "number") return val
        if (val && typeof val === "object" && "total" in val) {
          const total = (val as { total?: unknown }).total
          return typeof total === "number" ? total : 0
        }
        return 0
      }

      const cacheReadInputTokens = normalizeTokenCount(input.usage.cachedInputTokens)
      const cacheWriteInputTokens = normalizeTokenCount(
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0,
      )

      // AI SDK 6.x: inputTokens always includes cached tokens for all providers
      const adjustedInputTokens =
        normalizeTokenCount(input.usage.inputTokens) - cacheReadInputTokens - cacheWriteInputTokens
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }

      const tokens = {
        input: safe(adjustedInputTokens),
        output: safe(normalizeTokenCount(input.usage.outputTokens)),
        reasoning: safe(normalizeTokenCount(input.usage.reasoningTokens)),
        cache: {
          write: safe(cacheWriteInputTokens),
          read: safe(cacheReadInputTokens),
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
