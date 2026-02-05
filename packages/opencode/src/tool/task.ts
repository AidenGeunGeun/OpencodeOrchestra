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

const log = Log.create({ service: "task" })

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
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

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      
      // OpenCodeOrchestra: Calculate current depth by traversing parentID chain
      // PM (depth 0) → Orchestrator (depth 1) → Subagent (depth 2+)
      async function calculateDepth(sessionID: string): Promise<number> {
        let depth = 0
        let currentID: string | undefined = sessionID
        while (currentID) {
          const sess: Awaited<ReturnType<typeof Session.get>> | undefined = 
            await Session.get(currentID).catch(() => undefined)
          if (!sess?.parentID) break
          currentID = sess.parentID
          depth++
        }
        return depth
      }
      
      const currentDepth = await calculateDepth(ctx.sessionID)
      // OpenCodeOrchestra: Depth hierarchy enforcement
      // - PM (depth 0) spawns orchestrator → depth 1
      // - PM (depth 0) spawns non-orchestrator → depth 2 (skip depth 1)
      // - Orchestrator (depth 1) spawns anything → depth 2+
      const childDepth = (() => {
        if (currentDepth === 0 && params.subagent_type === "orchestrator") {
          return 1 // Only orchestrator resides at depth 1
        }
        if (currentDepth === 0) {
          return 2 // PM's non-orchestrator sub-agents skip to depth 2
        }
        return currentDepth + 1 // Normal increment for orchestrator's sub-agents
      })()
      
      // OpenCodeOrchestra: Determine completion mode based on agent config
      // singleShot: true (default) → auto-return first response (subagents)
      // singleShot: false → wait for finish_task signal (orchestrators)
      // ENFORCED: depth 2+ is ALWAYS singleShot regardless of agent config
      const isSingleShot = childDepth >= 2 ? true : (agent.singleShot ?? true)
      
      log.info("spawning subagent", {
        agent: agent.name,
        parentDepth: currentDepth,
        childDepth,
        singleShot: isSingleShot,
        agentConfig: agent.singleShot,
      })

      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

return await Session.create({
          parentID: ctx.sessionID,
          agentID: agent.name, // OpenCodeOrchestra: Store agent type for subagent sessions
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      type ToolStatus = "completed" | "error" | "pending" | "running"
      const messageID = Identifier.ascending("message")
      const parts: Record<string, { id: string; tool: string; state: { status: ToolStatus; title: string | undefined } }> = {}
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

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // OpenCodeOrchestra: Handle based on singleShot mode
      if (isSingleShot) {
        // Single-shot mode (subagents): await first response and return
        log.info("executing single-shot subagent", { agent: agent.name, sessionID: session.id })
        
        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            ...(hasTaskPermission ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })
        unsub()
        
        const messages = await Session.messages({ sessionID: session.id })
        const summary = messages
          .filter((x) => x.info.role === "assistant")
          .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
          .map((part) => ({
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }))
        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        const output = text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")

        return {
          title: params.description,
          metadata: {
            summary,
            sessionId: session.id,
            model,
          },
          output,
        }
      } else {
        // Persistent mode (orchestrators): wait for finish_task signal
        log.info("executing persistent orchestrator", { agent: agent.name, sessionID: session.id })
        
        // Result from finish_task tool (received via Bus event)
        interface FinishTaskResult {
          status: "completed" | "failed" | "cancelled"
          summary: string
          learnings?: string[]
        }

        // Set up finish_task listener
        const finishTaskPromise = new Promise<FinishTaskResult>((resolve, reject) => {
          const finishUnsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
            if (evt.properties.part.sessionID !== session.id) return
            if (evt.properties.part.type !== "tool") return
            if (evt.properties.part.tool !== "finish_task") return
            if (evt.properties.part.state.status !== "completed") return
            
            log.info("finish_task signal received", { sessionID: session.id })
            finishUnsub()
            
            // Get data from the tool's metadata (set by finish_task tool)
            const part = evt.properties.part as MessageV2.ToolPart
            const metadata = part.state.status === "completed" ? part.state.metadata : undefined
            
            resolve({
              status: (metadata?.status as FinishTaskResult["status"]) ?? "completed",
              summary: (metadata?.summary as string) ?? "Task completed",
              learnings: metadata?.learnings as string[] | undefined,
            })
          })
          
          // Also reject on abort
          ctx.abort.addEventListener("abort", () => {
            finishUnsub()
            reject(new Error("Task aborted"))
          })
        })

        // Start the orchestrator prompt loop (fire and DON'T wait for completion)
        // The orchestrator will call finish_task when ready
        SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            finish_task: true, // Enable finish_task for orchestrators
            ...(hasTaskPermission ? {} : { task: false }),
            // primary_tools (DCP: compress/distill/prune) intentionally NOT denied for depth-1 orchestrators
          },
          parts: promptParts,
        }).catch((error) => {
          log.error("orchestrator prompt failed", { error: String(error), sessionID: session.id })
        })

        // Wait for finish_task signal
        log.info("waiting for finish_task signal", { sessionID: session.id })
        const result = await finishTaskPromise
        unsub()
        
        const messages = await Session.messages({ sessionID: session.id })
        const summary = messages
          .filter((x) => x.info.role === "assistant")
          .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
          .map((part) => ({
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }))

        return {
          title: `${params.description} (${result.status})`,
          metadata: {
            summary,
            sessionId: session.id,
            model,
          },
          output: `[${result.status.toUpperCase()}] ${result.summary}` + 
            (result.learnings?.length ? 
              "\n\nLearnings:\n" + result.learnings.map(l => `- ${l}`).join("\n") : "") +
            "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n"),
        }
      }
    },
  }
})
