// OCO-only file: durable Orchestrator-to-PM handoff state. See oco-dev skill deltas-catalog.md.

import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Database, NotFoundError, and, eq, isNull } from "../storage/db"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { OrchestratorCompletionTable, MessageTable, PartTable } from "./session.sql"
import { SessionPrompt } from "./prompt"
import { SessionStatus } from "./status"

export namespace OrchestratorCompletion {
  const log = Log.create({ service: "session.orchestrator-completion" })

  export type Status = "completed" | "failed" | "cancelled"

  export interface Info {
    childSessionID: string
    parentSessionID: string
    status: Status
    summary: string
    learnings?: string[]
    messageID?: string
    partID?: string
    time: {
      created: number
      updated: number
    }
  }

  export interface HandoffInput {
    childSessionID: string
    status: Status
    summary: string
    learnings?: string[]
  }

  export interface HandoffResult {
    info: Info
    delivered: boolean
    duplicate: boolean
  }

  function fromRow(row: typeof OrchestratorCompletionTable.$inferSelect): Info {
    return {
      childSessionID: row.child_session_id,
      parentSessionID: row.parent_session_id,
      status: row.status,
      summary: row.summary,
      learnings: row.learnings ?? undefined,
      messageID: row.message_id ?? undefined,
      partID: row.part_id ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  function escapeXML(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
  }

  function toXML(input: {
    childSessionID: string
    status: Status
    summary: string
    learnings?: string[]
  }) {
    const learnings = input.learnings?.length
      ? `\n<learnings>\n${input.learnings.map((item) => `- ${escapeXML(item)}`).join("\n")}\n</learnings>`
      : ""

    return [
      `<orchestrator-handoff task_id="${escapeXML(input.childSessionID)}" status="${escapeXML(input.status)}">`,
      "<summary>",
      escapeXML(input.summary),
      "</summary>" + learnings,
      "</orchestrator-handoff>",
    ].join("\n")
  }

  async function lastUserMessage(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") return item.info
    }
  }

  async function resolveParentContext(session: Session.Info) {
    const lastUser = await lastUserMessage(session.id)
    const agentName = session.agentID ?? lastUser?.agent ?? (await Agent.defaultAgent())
    const agent = await Agent.get(agentName)

    return {
      agent: agent?.name ?? agentName,
      model: lastUser?.model ?? agent?.model ?? (await Provider.defaultModel()),
      format: lastUser?.format,
      system: lastUser?.system,
      tools: lastUser?.tools,
      variant: lastUser?.variant,
    }
  }

  async function hasAssistantResponse(sessionID: string, messageID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "assistant" && item.info.parentID === messageID) return true
    }
    return false
  }

  function wakeParent(parentSessionID: string, childSessionID: string, messageID: string) {
    const startLoop = () => {
      void SessionPrompt.loop(parentSessionID).catch((error) => {
        log.error("failed to wake parent session after orchestrator handoff", {
          parentSessionID,
          childSessionID,
          error,
        })
      })
    }

    const unsubscribe = Bus.subscribe(SessionStatus.Event.Status, (evt) => {
      if (evt.properties.sessionID !== parentSessionID) return
      if (evt.properties.status.type !== "idle") return

      void hasAssistantResponse(parentSessionID, messageID)
        .then((responded) => {
          if (responded) {
            unsubscribe()
            return
          }
          startLoop()
        })
        .catch((error) => {
          unsubscribe()
          log.error("failed to inspect parent orchestrator handoff state", {
            parentSessionID,
            childSessionID,
            error,
          })
        })
    })

    void hasAssistantResponse(parentSessionID, messageID)
      .then((responded) => {
        if (responded) {
          unsubscribe()
          return
        }
        if (SessionStatus.get(parentSessionID).type !== "idle") return
        startLoop()
      })
      .catch((error) => {
        unsubscribe()
        log.error("failed to inspect parent orchestrator handoff state", {
          parentSessionID,
          childSessionID,
          error,
        })
      })
  }

  function validateOrchestratorSession(child: Session.Info, parent: Session.Info) {
    if (child.agentID !== "orchestrator") {
      throw new Error("handoff_to_pm can only be called from an orchestrator session")
    }
    if (!child.parentID) {
      throw new Error("handoff_to_pm can only be called from a child orchestrator session")
    }
    if (child.parentID !== parent.id) {
      throw new Error("handoff_to_pm parent session mismatch")
    }
    if (parent.parentID) {
      throw new Error("handoff_to_pm is only available to depth-1 orchestrators")
    }
  }

  export async function getByChild(childSessionID: string) {
    const row = Database.use((db) =>
      db
        .select()
        .from(OrchestratorCompletionTable)
        .where(eq(OrchestratorCompletionTable.child_session_id, childSessionID))
        .get(),
    )
    return row ? fromRow(row) : undefined
  }

  export async function listByParent(parentSessionID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(OrchestratorCompletionTable)
        .where(eq(OrchestratorCompletionTable.parent_session_id, parentSessionID))
        .all()
        .map(fromRow),
    )
  }

  export async function handoff(input: HandoffInput): Promise<HandoffResult> {
    const child = await Session.get(input.childSessionID)
    if (!child.parentID) {
      throw new Error("handoff_to_pm can only be called from a child orchestrator session")
    }

    const parent = await Session.get(child.parentID).catch((error) => {
      if (error instanceof NotFoundError) throw new Error("Parent PM session not found")
      throw error
    })
    validateOrchestratorSession(child, parent)

    const parentContext = await resolveParentContext(parent)
    const messageID = Identifier.ascending("message")
    const partID = Identifier.ascending("part")
    const now = Date.now()
    const message: MessageV2.User = {
      id: messageID,
      role: "user",
      sessionID: parent.id,
      time: {
        created: now,
      },
      agent: parentContext.agent,
      model: parentContext.model,
      format: parentContext.format,
      system: parentContext.system,
      tools: parentContext.tools,
      variant: parentContext.variant,
    }
    const part: MessageV2.TextPart = {
      id: partID,
      sessionID: parent.id,
      messageID,
      type: "text",
      text: toXML({
        childSessionID: child.id,
        status: input.status,
        summary: input.summary,
        learnings: input.learnings,
      }),
      synthetic: true,
    }
    const { id: newMessageID, sessionID: messageSessionID, ...messageData } = message
    const messageRow: typeof MessageTable.$inferInsert = {
      id: newMessageID,
      session_id: messageSessionID,
      time_created: now,
      data: messageData,
    }
    const { id: newPartID, messageID: partMessageID, sessionID: partSessionID, ...partData } = part
    const partRow: typeof PartTable.$inferInsert = {
      id: newPartID,
      message_id: partMessageID,
      session_id: partSessionID,
      time_created: now,
      data: partData,
    }

    const result = Database.transaction((db) => {
      const existing = db
        .select()
        .from(OrchestratorCompletionTable)
        .where(eq(OrchestratorCompletionTable.child_session_id, child.id))
        .get()

      if (existing?.message_id) {
        return {
          info: fromRow(existing),
          delivered: false,
          duplicate: true,
        }
      }

      db.insert(MessageTable).values(messageRow).run()

      db.insert(PartTable).values(partRow).run()

      const values = {
        child_session_id: child.id,
        parent_session_id: parent.id,
        status: input.status,
        summary: input.summary,
        learnings: input.learnings,
        message_id: message.id,
        part_id: part.id,
        time_created: existing?.time_created ?? now,
        time_updated: now,
      }

      const row = existing
        ? db
            .update(OrchestratorCompletionTable)
            .set(values)
            .where(
              and(
                eq(OrchestratorCompletionTable.child_session_id, child.id),
                isNull(OrchestratorCompletionTable.message_id),
              ),
            )
            .returning()
            .get()
        : db.insert(OrchestratorCompletionTable).values(values).returning().get()

      const info = fromRow(row ?? existing!)

      Database.effect(() => {
        Bus.publish(MessageV2.Event.Updated, { info: message })
        Bus.publish(MessageV2.Event.PartUpdated, { part: structuredClone(part) })
      })

      return {
        info,
        delivered: true,
        duplicate: false,
      }
    })

    if (result.delivered && result.info.messageID) {
      wakeParent(parent.id, child.id, result.info.messageID)
    }

    return result
  }
}
