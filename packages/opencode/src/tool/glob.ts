import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { InternalPath } from "@/security/internal-path"

const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 300

// OCO: Bound agent-facing searches so pathological trees cannot stall turns.
function timeoutSeconds(input: number | undefined) {
  return input ?? DEFAULT_TIMEOUT_SECONDS
}

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
    timeout: z.number().positive().max(MAX_TIMEOUT_SECONDS).optional().describe("Optional timeout in seconds (default 30, max 300)"),
    followSymlinks: z.boolean().optional().describe("Follow symlinks during search. Defaults to false."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        timeout: params.timeout,
        followSymlinks: params.followSymlinks,
      },
    })

    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const limit = 100
    const files = []
    let truncated = false

    if (ctx.abort.aborted) {
      throw new Error("glob search was cancelled before it completed.")
    }

    const rgPath = await Ripgrep.filepath()
    const args = [rgPath, "--files", "--glob=!.git/*", "--hidden", `--glob=${params.pattern}`]
    if (params.followSymlinks === true) args.push("--follow")

    const proc = Bun.spawn(args, {
      cwd: search,
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1024 * 1024 * 20,
    })

    let timedOut = false
    let cancelled = false
    let stoppedAfterLimit = false
    const searchTimeout = timeoutSeconds(params.timeout)
    const timeoutMessage = `glob search timed out after ${searchTimeout}s. The search was likely too broad or hit a slow tree. Retry with a narrower path, a more specific glob pattern such as "src/**/*.ts", or pass a larger explicit timeout if the wide search is intentional.`
    const terminate = () => {
      try {
        proc.kill()
      } catch {
        // Process may already be gone.
      }
    }

    const timeoutId = setTimeout(() => {
      timedOut = true
      terminate()
    }, Math.ceil(searchTimeout * 1000))
    const abortHandler = () => {
      cancelled = true
      terminate()
    }
    ctx.abort.addEventListener("abort", abortHandler, { once: true })
    const stderr = new Response(proc.stderr).text()

    try {
      for await (const file of Ripgrep.parseFilesOutput(search, proc.stdout)) {
        if (files.length >= limit) {
          truncated = true
          stoppedAfterLimit = true
          terminate()
          break
        }
        const full = path.resolve(search, file)
        if (InternalPath.contains(full)) continue
        const stats = await Bun.file(full)
          .stat()
          .then((x) => x.mtime.getTime())
          .catch(() => 0)
        files.push({
          path: full,
          mtime: stats,
        })
      }

      const [exitCode, errorOutput] = await Promise.all([proc.exited, stderr])
      if (timedOut) throw new Error(timeoutMessage)
      if (cancelled) throw new Error("glob search was cancelled before it completed.")
      if (exitCode !== 0 && !stoppedAfterLimit && files.length === 0 && errorOutput.trim()) {
        throw new Error(`ripgrep failed: ${errorOutput}`)
      }
    } catch (error) {
      if (timedOut) throw new Error(timeoutMessage, { cause: error })
      if (cancelled) throw new Error("glob search was cancelled before it completed.", { cause: error })
      throw error
    } finally {
      clearTimeout(timeoutId)
      ctx.abort.removeEventListener("abort", abortHandler)
    }

    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push("(Results are truncated. Consider using a more specific path or pattern.)")
      }
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
