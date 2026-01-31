import { Tool } from "./tool"
import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Lock } from "../util/lock"
import path from "path"
import fs from "fs/promises"

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
  function getStateFile(projectRoot: string): string {
    return path.join(projectRoot, ".opencode", "project-state.json")
  }

  export async function read(projectRoot: string): Promise<ProjectState> {
    const stateFile = getStateFile(projectRoot)
    try {
      using _ = await Lock.read(stateFile)
      const file = Bun.file(stateFile)
      if (!(await file.exists())) {
        log.info("no existing project state, returning defaults", { projectRoot })
        return ProjectStateSchema.parse({})
      }
      const data = await file.json()
      log.info("read project state", { projectRoot })
      return ProjectStateSchema.parse(data)
    } catch (e) {
      throw e
    }
  }

  export async function write(projectRoot: string, state: Partial<ProjectState>): Promise<ProjectState> {
    const stateFile = getStateFile(projectRoot)
    const dir = path.dirname(stateFile)
    await fs.mkdir(dir, { recursive: true })
    using _ = await Lock.write(stateFile)
    const file = Bun.file(stateFile)
    const existing = (await file.exists()) ? ProjectStateSchema.parse(await file.json()) : ProjectStateSchema.parse({})
    const updated: ProjectState = {
      objectives: state.objectives ?? existing.objectives,
      decisions: state.decisions ?? existing.decisions,
      learnings: state.learnings ?? existing.learnings,
      todos: state.todos ?? existing.todos,
      lastUpdated: new Date().toISOString(),
    }
    await Bun.write(stateFile, JSON.stringify(updated, null, 2))
    log.info("wrote project state", { projectRoot })
    return updated
  }
}

/**
 * Get project root directory for state storage
 */
function getProjectRoot(): string {
  if (Instance.project.vcs && Instance.worktree !== "/") {
    return Instance.worktree
  }
  return Instance.directory
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

State is stored at .opencode/project-state.json in the project root (git root if present, otherwise the current working directory).

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

      const projectRoot = getProjectRoot()
      const state = await ProjectStateStorage.read(projectRoot)

      log.info("project_state_read executed", { projectRoot, sessionID: ctx.sessionID })
      const stateFile = path.join(projectRoot, ".opencode", "project-state.json")

      return {
        title: "Project State",
        metadata: { projectRoot, stateFile },
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

State is stored at .opencode/project-state.json in the project root (git root if present, otherwise the current working directory).

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

      const projectRoot = getProjectRoot()
      const updated = await ProjectStateStorage.write(projectRoot, params)

      log.info("project_state_write executed", { 
        projectRoot, 
        sessionID: ctx.sessionID,
        updatedFields: Object.keys(params).filter(k => params[k as keyof typeof params] !== undefined),
      })

      return {
        title: "Project State Updated",
        metadata: { projectRoot, lastUpdated: updated.lastUpdated },
        output: `Project state updated successfully.\n\nCurrent state:\n${JSON.stringify(updated, null, 2)}`,
      }
    },
  }
})
