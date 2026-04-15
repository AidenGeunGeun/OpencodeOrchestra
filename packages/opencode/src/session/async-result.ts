import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { NotFoundError } from "../storage/db"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { SessionStatus } from "./status"

export namespace AsyncResult {
  const log = Log.create({ service: "session.async-result" })

  export interface Result {
    taskID: string
    agent: string
    status: "completed" | "failed" | "cancelled"
    summary: string
    learnings?: string[]
  }

  function escapeXML(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
  }

  function toXML(result: Result) {
    const learnings = result.learnings?.length
      ? `\n<learnings>\n${result.learnings.map((item) => `- ${escapeXML(item)}`).join("\n")}\n</learnings>`
      : ""

    return [
      `<async-result task_id="${escapeXML(result.taskID)}" agent="${escapeXML(result.agent)}" status="${escapeXML(result.status)}">`,
      "<summary>",
      escapeXML(result.summary),
      "</summary>" + learnings,
      "</async-result>",
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
    let newestAssistant:
      | {
          id: string
          created: number
        }
      | undefined
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "assistant" && newestAssistant === undefined) {
        newestAssistant = {
          id: item.info.id,
          created: item.info.time.created,
        }
      }
      if (item.info.role !== "user" || item.info.id !== messageID) continue
      return (
        newestAssistant !== undefined &&
        (newestAssistant.created > item.info.time.created ||
          (newestAssistant.created === item.info.time.created && newestAssistant.id > item.info.id))
      )
    }
    return false
  }

  function wakeParent(parentSessionID: string, taskID: string, messageID: string) {
    const startLoop = () => {
      void SessionPrompt.loop(parentSessionID).catch((error) => {
        log.error("failed to wake parent session after async result injection", {
          parentSessionID,
          taskID,
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
          log.error("failed to inspect parent async result state", {
            parentSessionID,
            taskID,
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
        startLoop()
      })
      .catch((error) => {
        unsubscribe()
        log.error("failed to inspect parent async result state", {
          parentSessionID,
          taskID,
          error,
        })
      })
  }

  export async function inject(parentSessionID: string, result: Result) {
    let session: Session.Info
    try {
      session = await Session.get(parentSessionID)
    } catch (error) {
      if (error instanceof NotFoundError) {
        log.info("skipping async result injection for missing parent session", {
          parentSessionID,
          taskID: result.taskID,
          agent: result.agent,
        })
        return
      }
      throw error
    }

    const parent = await resolveParentContext(session)
    const message: MessageV2.User = {
      id: Identifier.ascending("message"),
      role: "user",
      sessionID: parentSessionID,
      time: {
        created: Date.now(),
      },
      agent: parent.agent,
      model: parent.model,
      format: parent.format,
      system: parent.system,
      tools: parent.tools,
      variant: parent.variant,
    }
    const part: MessageV2.TextPart = {
      id: Identifier.ascending("part"),
      sessionID: parentSessionID,
      messageID: message.id,
      type: "text",
      text: toXML(result),
      synthetic: true,
    }

    await Session.updateMessage(message)
    await Session.updatePart(part)

    wakeParent(parentSessionID, result.taskID, message.id)
  }

  export async function injectError(parentSessionID: string, taskID: string, agent: string, errorMessage: string) {
    return inject(parentSessionID, {
      taskID,
      agent,
      status: "failed",
      summary: errorMessage,
    })
  }
}
