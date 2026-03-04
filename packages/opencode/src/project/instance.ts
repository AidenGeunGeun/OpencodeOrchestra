import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
  byDirectory: new Map<string, Promise<void>>(),
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const pendingDisposal = disposal.byDirectory.get(input.directory)
    if (pendingDisposal) await pendingDisposal

    let existing = cache.get(input.directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory: input.directory })
      existing = iife(async () => {
        const { project, sandbox } = await Project.fromDirectory(input.directory)
        const ctx = {
          directory: input.directory.replaceAll("\\", "/"),
          worktree: sandbox.replaceAll("\\", "/"),
          project,
        }
        await context.provide(ctx, async () => {
          await input.init?.()
        })
        return ctx
      })
      cache.set(input.directory, existing)
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    const normalized = filepath.replaceAll("\\", "/")
    if (Filesystem.contains(Instance.directory, normalized)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, normalized)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    const directory = Instance.directory
    const existing = disposal.byDirectory.get(directory)
    if (existing) return existing

    const promise = iife(async () => {
      Log.Default.info("disposing instance", { directory })
      await State.dispose(directory)
      cache.delete(directory)
      GlobalBus.emit("event", {
        directory,
        payload: {
          type: "server.instance.disposed",
          properties: {
            directory,
          },
        },
      })
    }).finally(() => {
      if (disposal.byDirectory.get(directory) === promise) {
        disposal.byDirectory.delete(directory)
      }
    })

    disposal.byDirectory.set(directory, promise)
    return promise
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
