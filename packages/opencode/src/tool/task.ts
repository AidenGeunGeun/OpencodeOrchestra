import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Log } from "../util/log"
import { DesignContext } from "../session/design"

const log = Log.create({ service: "task" })

export const TaskToolParameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export type TaskToolParams = z.infer<typeof TaskToolParameters>

type ToolStatus = "completed" | "error" | "pending" | "running"
type TaskPermissionFlags = {
  hasTaskPermission: boolean
  hasTodoWritePermission: boolean
  hasTodoReadPermission: boolean
}
type TaskModel = {
  modelID: string
  providerID: string
}
type TaskSummaryPart = {
  id: string
  tool: string
  state: {
    status: ToolStatus
    title: string | undefined
  }
}

export type PreparedTaskSession = {
  session: Session.Info
  agent: Agent.Info
  promptParts: Awaited<ReturnType<typeof SessionPrompt.resolvePromptParts>>
  toolsOverlay: Record<string, boolean>
  model: TaskModel
  singleShot: boolean
  depth: number
  cleanup: () => void
}

type PrepareTaskSessionOptions = {
  async?: boolean
}

export async function listAccessibleTaskAgents(caller?: Agent.Info) {
  const agents = await Agent.list().then((items) => items.filter((item) => item.mode !== "primary"))

  if (!caller) return agents

  return agents.filter((item) => PermissionNext.evaluate("task", item.name, caller.permission).action !== "deny")
}

export async function renderTaskDescription(template: string, caller?: Agent.Info) {
  const agents = await listAccessibleTaskAgents(caller)
  return template.replace(
    "{agents}",
    agents
      .map((item) => `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
}

// OCO: depth walk powers PM/Orchestrator/specialist hierarchy
async function calculateDepth(sessionID: string): Promise<number> {
  let depth = 0
  let currentID: string | undefined = sessionID
  while (currentID) {
    const session: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(currentID).catch(() => undefined)
    if (!session?.parentID) break
    currentID = session.parentID
    depth++
  }
  return depth
}

function getTaskPermissionFlags(agent: Agent.Info): TaskPermissionFlags {
  return {
    hasTaskPermission: agent.permission.some((rule) => rule.permission === "task"),
    hasTodoWritePermission: agent.permission.some(
      (rule) => rule.permission === "todowrite" && rule.action === "allow",
    ),
    hasTodoReadPermission: agent.permission.some(
      (rule) => rule.permission === "todoread" && rule.action === "allow",
    ),
  }
}

function buildChildSessionPermissions(flags: TaskPermissionFlags, config: Awaited<ReturnType<typeof Config.get>>) {
  return [
    ...(flags.hasTodoWritePermission
      ? []
      : [
          {
            permission: "todowrite" as const,
            pattern: "*" as const,
            action: "deny" as const,
          },
        ]),
    ...(flags.hasTodoReadPermission
      ? []
      : [
          {
            permission: "todoread" as const,
            pattern: "*" as const,
            action: "deny" as const,
          },
        ]),
    ...(flags.hasTaskPermission
      ? []
      : [
          {
            permission: "task" as const,
            pattern: "*" as const,
            action: "deny" as const,
          },
        ]),
    ...(config.experimental?.primary_tools?.map((tool) => ({
      pattern: "*",
      action: "allow" as const,
      permission: tool,
    })) ?? []),
  ]
}

function buildTaskToolsOverlay(
  flags: TaskPermissionFlags,
  config: Awaited<ReturnType<typeof Config.get>>,
  input: { singleShot: boolean; async: boolean },
) {
  return {
    ...(flags.hasTodoWritePermission ? {} : { todowrite: false }),
    ...(flags.hasTodoReadPermission ? {} : { todoread: false }),
    ...(!input.singleShot ? { handoff_to_pm: true } : {}),
    ...(flags.hasTaskPermission ? {} : { task: false }),
    ...(input.singleShot
      ? Object.fromEntries((config.experimental?.primary_tools ?? []).map((tool) => [tool, false]))
      : {}),
    ...(input.async ? { async_task: false } : {}),
  }
}

async function getTaskModel(ctx: Tool.Context, agent: Agent.Info): Promise<TaskModel> {
  const message = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
  if (message.info.role !== "assistant") throw new Error("Not an assistant message")

  return agent.model ?? {
    modelID: message.info.modelID,
    providerID: message.info.providerID,
  }
}

async function getTaskSummary(sessionID: string): Promise<TaskSummaryPart[]> {
  const messages = await Session.messages({ sessionID })
  return messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool"))
    .map((part) => ({
      id: part.id,
      tool: part.tool,
      state: {
        status: part.state.status,
        title: part.state.status === "completed" ? part.state.title : undefined,
      },
    }))
}

async function resolveTaskPromptParts(params: TaskToolParams, ctx: Tool.Context) {
  return [...(await SessionPrompt.resolvePromptParts(params.prompt)), ...DesignContext.handoffParts(ctx.messages, params.prompt)]
}

export async function prepareTaskSession(
  params: TaskToolParams,
  ctx: Tool.Context,
  options: PrepareTaskSessionOptions = {},
): Promise<PreparedTaskSession> {
  const config = await Config.get()

  if (!ctx.extra?.bypassAgentCheck) {
    await ctx.ask({
      permission: "task",
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: {
        description: params.description,
        subagent_type: params.subagent_type,
      },
    })
  }

  const agent = await Agent.get(params.subagent_type)
  if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

  const permissionFlags = getTaskPermissionFlags(agent)
  const currentDepth = await calculateDepth(ctx.sessionID)
  // OCO: root-to-orchestrator is depth 1; other root children are specialists
  const childDepth = (() => {
    if (currentDepth === 0 && params.subagent_type === "orchestrator") {
      return 1
    }
    if (currentDepth === 0) {
      return 2
    }
    return currentDepth + 1
  })()
  // OCO: specialists return single-shot; orchestrators persist until handoff_to_pm
  const singleShot = childDepth >= 2 ? true : (agent.singleShot ?? true)

  log.info("spawning subagent", {
    agent: agent.name,
    parentDepth: currentDepth,
    childDepth,
    singleShot,
    agentConfig: agent.singleShot,
  })

  const session = await iife(async () => {
    if (params.task_id) {
      const found = await Session.get(params.task_id).catch(() => {})
      if (found) {
        if (options.async && found.async !== true) {
          return Session.update(found.id, (draft) => {
            draft.async = true
          })
        }
        return found
      }
    }

    // OCO: child sessions keep parent and agent identity for navigation/resume
    return Session.create({
      parentID: ctx.sessionID,
      agentID: agent.name,
      title: params.description + ` (@${agent.name}${options.async ? " async" : ""} subagent)`,
      permission: buildChildSessionPermissions(permissionFlags, config),
      async: options.async,
    })
  })

  const model = await getTaskModel(ctx, agent)

  ctx.metadata({
    title: params.description,
    metadata: {
      sessionId: session.id,
      model,
    },
  })

  // For async tasks the tool returns immediately, so ctx.abort fires when the parent
  // loop ends naturally — NOT when the user cancels. Wiring it to child cancel would
  // kill the child on every normal turn completion. Skip the listener for async children
  // entirely; OCO intentionally does not cascade cancellation to async background work,
  // so an async subagent runs to completion (or its own timeout) regardless of whether
  // the parent turn ends naturally or is cancelled.
  if (options.async) {
    const promptParts = await resolveTaskPromptParts(params, ctx)
    return {
      session,
      agent,
      promptParts,
      toolsOverlay: buildTaskToolsOverlay(permissionFlags, config, { singleShot, async: true }),
      model,
      singleShot,
      depth: childDepth,
      cleanup: () => {},
    }
  }

  const cancel = () => {
    SessionPrompt.cancel(session.id)
  }
  ctx.abort.addEventListener("abort", cancel)

  try {
    const promptParts = await resolveTaskPromptParts(params, ctx)

    return {
      session,
      agent,
      promptParts,
      toolsOverlay: buildTaskToolsOverlay(permissionFlags, config, {
        singleShot,
        async: false,
      }),
      model,
      singleShot,
      depth: childDepth,
      cleanup: () => ctx.abort.removeEventListener("abort", cancel),
    }
  } catch (error) {
    ctx.abort.removeEventListener("abort", cancel)
    throw error
  }
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const description = await renderTaskDescription(DESCRIPTION, ctx?.agent)

  return {
    description,
    parameters: TaskToolParameters,
    async execute(params: TaskToolParams, ctx) {
      const prepared = await prepareTaskSession(params, ctx)
      using _ = defer(prepared.cleanup)

      const { session, agent, promptParts, toolsOverlay, model, singleShot } = prepared
      const messageID = Identifier.ascending("message")
      const parts: Record<string, TaskSummaryPart> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
            model,
          },
        })
      })

      if (singleShot) {
        log.info("executing single-shot subagent", { agent: agent.name, sessionID: session.id })

        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: toolsOverlay,
          parts: promptParts,
        })
        unsub()

        const summary = await getTaskSummary(session.id)
        const text = result.parts.findLast((part) => part.type === "text")?.text ?? ""

        const output = [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")

        return {
          title: params.description,
          metadata: {
            summary,
            sessionId: session.id,
            model,
          },
          output,
        }
      }

      // OCO: persistent orchestrator path launches and returns; completion arrives via handoff_to_pm.
      log.info("executing persistent orchestrator", { agent: agent.name, sessionID: session.id })

      SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: toolsOverlay,
        parts: promptParts,
      })
        .catch((error) => {
          log.error("orchestrator prompt failed", { error: String(error), sessionID: session.id })
        })
        .finally(() => {
          unsub()
        })

      return {
        title: params.description,
        metadata: {
          summary: [],
          sessionId: session.id,
          model,
        },
        output: [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "Orchestrator launched. Completion will arrive as a PM steering message when the Orchestrator calls handoff_to_pm.",
        ].join("\n"),
      }
    },
  }
})
