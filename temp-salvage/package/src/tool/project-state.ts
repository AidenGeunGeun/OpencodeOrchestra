import { Tool } from "./tool"
import z from "zod"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Global } from "../global"

const log = Log.create({ service: "project-state" })

/**
 * Project State schema - persisted for cross-session PM memory
 */
export const ProjectStateSchema = z.object({
  objectives: z.array(z.string()).default([]),
  decisions: z.array(z.object({
    decision: z.string(),
    rationale: z.string(),
    timestamp: z.string(),
  })).default([]),
  learnings: z.array(z.object({
    topic: z.string(),
    insight: z.string(),
  })).default([]),
  todos: z.array(z.object({
    id: z.string(),
    task: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["high", "medium", "low"]),
  })).default([]),
  lastUpdated: z.string().optional(),
})

export type ProjectState = z.infer<typeof ProjectStateSchema>

/**
 * Project State storage namespace
 */
export namespace ProjectStateStorage {
  function getKey(projectID: string): string[] {
    return ["project-state", projectID]
  }

  export async function read(projectID: string): Promise<ProjectState> {
    try {
      const data = await Storage.read<ProjectState>(getKey(projectID))
      log.info("read project state", { projectID })
      return ProjectStateSchema.parse(data)
    } catch (e) {
      if (Storage.NotFoundError.isInstance(e)) {
        log.info("no existing project state, returning defaults", { projectID })
        return ProjectStateSchema.parse({})
      }
      throw e
    }
  }

  export async function write(projectID: string, state: Partial<ProjectState>): Promise<ProjectState> {
    const existing = await read(projectID)
    const updated: ProjectState = {
      objectives: state.objectives ?? existing.objectives,
      decisions: state.decisions ?? existing.decisions,
      learnings: state.learnings ?? existing.learnings,
      todos: state.todos ?? existing.todos,
      lastUpdated: new Date().toISOString(),
    }
    await Storage.write(getKey(projectID), updated)
    log.info("wrote project state", { projectID })
    return updated
  }
}

/**
 * Get project ID from session context
 * PM sessions are always associated with a project
 */
async function getProjectID(ctx: { sessionID: string }): Promise<string> {
  // Use the root session ID as the project ID
  // This ensures all sessions in a hierarchy share the same project state
  const { Session } = await import("../session")
  type SessionInfo = Awaited<ReturnType<typeof Session.get>>
  
  let rootSessionID = ctx.sessionID
  let currentID: string | undefined = ctx.sessionID
  
  while (currentID) {
    const sess: SessionInfo | undefined = await Session.get(currentID).catch(() => undefined)
    if (!sess) break
    rootSessionID = currentID
    currentID = sess.parentID
  }
  
  return rootSessionID
}

/**
 * Check if current session is PM (depth 0)
 */
async function isPM(ctx: { sessionID: string }): Promise<boolean> {
  const { Session } = await import("../session")
  const session = await Session.get(ctx.sessionID).catch(() => undefined)
  // PM has no parent
  return session ? !session.parentID : false
}

// ============================================================================
// PROJECT_STATE_READ Tool
// ============================================================================

export const ProjectStateReadTool = Tool.define("project_state_read", async (ctx) => {
  return {
    description: `Read the current project state. This tool is ONLY available to PM (depth 0).

Returns:
- objectives: Current goals/objectives
- decisions: Important decisions with rationale
- learnings: Insights from codebase exploration
- todos: Task items and their status

Use this at session start to restore context from previous sessions.`,
    parameters: z.object({}),
    async execute(_params: z.infer<z.ZodObject<{}>>, ctx) {
      // Enforce PM-only
      const pmCheck = await isPM(ctx)
      if (!pmCheck) {
        throw new Error("project_state_read is PM-only (depth 0). Subagents cannot access project state.")
      }

      const projectID = await getProjectID(ctx)
      const state = await ProjectStateStorage.read(projectID)

      log.info("project_state_read executed", { projectID, sessionID: ctx.sessionID })

      return {
        title: "Project State",
        metadata: { projectID },
        output: JSON.stringify(state, null, 2),
      }
    },
  }
})

// ============================================================================
// PROJECT_STATE_WRITE Tool
// ============================================================================

const writeParameters = z.object({
  objectives: z
    .array(z.string())
    .optional()
    .describe("Current goals/objectives. Replaces existing objectives."),
  decisions: z
    .array(z.object({
      decision: z.string().describe("The decision made"),
      rationale: z.string().describe("Why this decision was made"),
      timestamp: z.string().describe("When the decision was made (ISO format)"),
    }))
    .optional()
    .describe("Important decisions with rationale. Replaces existing decisions."),
  learnings: z
    .array(z.object({
      topic: z.string().describe("Topic or area of the learning"),
      insight: z.string().describe("The insight or knowledge gained"),
    }))
    .optional()
    .describe("Insights from codebase exploration. Replaces existing learnings."),
  todos: z
    .array(z.object({
      id: z.string().describe("Unique ID for the todo item"),
      task: z.string().describe("Description of the task"),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Current status"),
      priority: z.enum(["high", "medium", "low"]).describe("Priority level"),
    }))
    .optional()
    .describe("Task items and progress. Replaces existing todos."),
})

export const ProjectStateWriteTool = Tool.define("project_state_write", async (ctx) => {
  return {
    description: `Update the project state. This tool is ONLY available to PM (depth 0).

Use this to:
- Track current objectives when they change
- Record important decisions with rationale
- Store learnings from codebase exploration
- Manage TODO items and progress

Each field is optional - only provided fields will be updated.
This state persists across sessions.`,
    parameters: writeParameters,
    async execute(params: z.infer<typeof writeParameters>, ctx) {
      // Enforce PM-only
      const pmCheck = await isPM(ctx)
      if (!pmCheck) {
        throw new Error("project_state_write is PM-only (depth 0). Subagents cannot modify project state.")
      }

      const projectID = await getProjectID(ctx)
      const updated = await ProjectStateStorage.write(projectID, params)

      log.info("project_state_write executed", { 
        projectID, 
        sessionID: ctx.sessionID,
        updatedFields: Object.keys(params).filter(k => params[k as keyof typeof params] !== undefined),
      })

      return {
        title: "Project State Updated",
        metadata: { projectID, lastUpdated: updated.lastUpdated },
        output: `Project state updated successfully.\n\nCurrent state:\n${JSON.stringify(updated, null, 2)}`,
      }
    },
  }
})
