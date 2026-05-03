// OCO-only file: Orchestrator completion handoff tool. See oco-dev skill deltas-catalog.md.

import z from "zod"
import { OrchestratorCompletion } from "../session/orchestrator-completion"
import { Tool } from "./tool"

const parameters = z.object({
  summary: z.string().describe("A concise summary of what was completed or why the task stopped"),
  status: z.enum(["completed", "failed", "cancelled"]).describe("The final Orchestrator status"),
  learnings: z
    .array(z.string())
    .optional()
    .describe("Important learnings, risks, skipped steps, or follow-up items for the PM"),
})

export const HandoffToPMTool = Tool.define("handoff_to_pm", {
  description: `Hand off Orchestrator completion to the parent PM session.

Use this tool when a persistent depth-1 Orchestrator reaches a terminal state: completed, failed, or cancelled.

This appends a durable PM steering message to the parent PM session with the status, summary, and learnings. It is idempotent: repeated calls for the same Orchestrator session return the existing handoff instead of appending duplicate PM messages.

This tool is ONLY available to persistent Orchestrator sessions (depth 1). Non-Orchestrator subagents cannot use the durable PM handoff path.`,
  parameters,
  async execute(params, ctx) {
    const result = await OrchestratorCompletion.handoff({
      childSessionID: ctx.sessionID,
      status: params.status,
      summary: params.summary,
      learnings: params.learnings,
    })

    const delivered = result.duplicate ? "already delivered" : "delivered"
    return {
      title: `Handoff ${delivered}: ${result.info.status}`,
      metadata: {
        parentSessionID: result.info.parentSessionID,
        childSessionID: result.info.childSessionID,
        status: result.info.status,
        summary: result.info.summary,
        learnings: result.info.learnings,
        messageID: result.info.messageID,
        duplicate: result.duplicate,
      },
      output: result.duplicate
        ? `Handoff already delivered to PM. Status: ${result.info.status}. Summary: ${result.info.summary}`
        : `Handoff delivered to PM. Status: ${result.info.status}. Summary: ${result.info.summary}`,
    }
  },
})
