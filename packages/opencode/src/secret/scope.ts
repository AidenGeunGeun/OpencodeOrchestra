// OCO-only file: Secure Env workspace scope resolver. See oco-dev skill deltas-catalog.md.
import { createHash } from "node:crypto"
import path from "node:path"
import { eq, Database } from "@/storage/db"
import { Instance } from "@/project/instance"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Project } from "@/project/project"

export namespace SecretScope {
  export type Info = {
    id: string
    label: string
    directory?: string
    kind: "project" | "workspace"
  }

  const WORKSPACE_PREFIX = "workspace:"

  export function current() {
    return fromDirectory({ directory: Instance.directory, project: Instance.project })
  }

  export function currentID() {
    return current().id
  }

  export async function forDirectory(directory: string) {
    const { project } = await Project.fromDirectory(directory)
    return fromDirectory({ directory, project })
  }

  export function forSession(sessionID: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select({ projectID: SessionTable.project_id, directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get(),
    )
    if (!row) return undefined
    if (row.projectID !== "global") return { id: row.projectID, label: row.projectID, kind: "project" }
    return workspace(row.directory)
  }

  export function fromDirectory(input: { directory: string; project?: Project.Info }): Info {
    if (input.project && input.project.id !== "global" && input.project.worktree !== "/") {
      return {
        id: input.project.id,
        label: input.project.name || input.project.worktree,
        directory: input.project.worktree,
        kind: "project",
      }
    }
    return workspace(input.directory)
  }

  export function workspaceID(directory: string) {
    const normalized = normalizeDirectory(directory)
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32)
    return `${WORKSPACE_PREFIX}${hash}`
  }

  function workspace(directory: string): Info {
    const normalized = normalizeDirectory(directory)
    const id = workspaceID(normalized)
    const label = path.basename(normalized) || normalized
    ensureWorkspaceProject({ id, directory: normalized, label })
    return { id, label, directory: normalized, kind: "workspace" }
  }

  function normalizeDirectory(directory: string) {
    return path.resolve(directory).replaceAll("\\", "/")
  }

  function ensureWorkspaceProject(input: { id: string; directory: string; label: string }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: input.id,
          worktree: input.directory,
          name: input.label,
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: ProjectTable.id,
          set: {
            worktree: input.directory,
            name: input.label,
            time_updated: now,
          },
        })
        .run(),
    )
  }
}
