import { Tool } from "./tool"
import z from "zod"
import { Session } from "../session"
import { Log } from "../util/log"

const log = Log.create({ service: "finish-task" })

const parameters = z.object({
  summary: z
    .string()
    .describe("A concise summary of what was accomplished in this task"),
  status: z
    .enum(["completed", "failed", "cancelled"])
    .describe("The completion status of the task"),
  learnings: z
    .array(z.string())
    .optional()
    .describe("Key learnings or insights from this task that should be preserved"),
})

export const FinishTaskTool = Tool.define("finish_task", async (ctx) => {
  return {
    description: `Signal completion of an orchestrator task and return control to the parent agent (PM).

Use this tool when:
- You have completed the assigned task
- You need to report failure and return control
- The user requests to cancel the current task

This tool is ONLY available to orchestrator agents (depth 1). Subagents (depth 2+) auto-complete on first response.`,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      // Get current session to find parent
      const session = await Session.get(ctx.sessionID)
      if (!session) {
        throw new Error("Cannot find current session")
      }

      const parentID = session.parentID
      if (!parentID) {
        throw new Error("finish_task can only be called from a child session (orchestrator/subagent)")
      }

      log.info("finish_task completed", {
        parentSessionID: parentID,
        childSessionID: ctx.sessionID,
        status: params.status,
      })

      // The tool result will be picked up by the Bus event listener in task.ts
      return {
        title: `Task ${params.status}: ${params.summary.slice(0, 50)}...`,
        metadata: {
          parentSessionID: parentID,
          childSessionID: ctx.sessionID,
          status: params.status,
          summary: params.summary,
          learnings: params.learnings,
        },
        output: `Task ${params.status}. Control returned to parent agent.\n\nSummary: ${params.summary}`,
      }
    },
  }
})
