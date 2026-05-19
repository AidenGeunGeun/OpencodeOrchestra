import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"
import { InternalPath } from "@/security/internal-path"

const MAX_LINE_LENGTH = 2000
const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 300

// OCO: Bound agent-facing searches so pathological trees cannot stall turns.
function timeoutSeconds(input: number | undefined) {
  return input ?? DEFAULT_TIMEOUT_SECONDS
}

async function runRipgrep(input: { args: string[]; timeout: number; abort: AbortSignal; timeoutMessage: string }) {
  if (input.abort.aborted) {
    throw new Error("grep search was cancelled before it completed.")
  }

  const proc = Bun.spawn(input.args, {
    stdout: "pipe",
    stderr: "pipe",
  })

  let timedOut = false
  let cancelled = false
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
  }, Math.ceil(input.timeout * 1000))
  const abortHandler = () => {
    cancelled = true
    terminate()
  }
  input.abort.addEventListener("abort", abortHandler, { once: true })

  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()

  try {
    const [output, errorOutput, exitCode] = await Promise.all([stdout, stderr, proc.exited])
    if (timedOut) throw new Error(input.timeoutMessage)
    if (cancelled) throw new Error("grep search was cancelled before it completed.")
    return { output, errorOutput, exitCode }
  } catch (error) {
    if (timedOut) throw new Error(input.timeoutMessage, { cause: error })
    if (cancelled) throw new Error("grep search was cancelled before it completed.", { cause: error })
    throw error
  } finally {
    clearTimeout(timeoutId)
    input.abort.removeEventListener("abort", abortHandler)
  }
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    timeout: z.number().positive().max(MAX_TIMEOUT_SECONDS).optional().describe("Optional timeout in seconds (default 30, max 300)"),
    followSymlinks: z.boolean().optional().describe("Follow symlinks during search. Defaults to false."),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
        timeout: params.timeout,
        followSymlinks: params.followSymlinks,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = [
      "-nH",
      "--hidden",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      params.pattern,
    ]
    if (params.followSymlinks === true) args.push("--follow")
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const searchTimeout = timeoutSeconds(params.timeout)
    const { output, errorOutput, exitCode } = await runRipgrep({
      args: [rgPath, ...args],
      timeout: searchTimeout,
      abort: ctx.abort,
      timeoutMessage: `grep search timed out after ${searchTimeout}s. The search was likely too broad or hit a slow tree. Retry with a narrower path, a tighter include pattern such as "*.ts" or "*.{ts,tsx}", or pass a larger explicit timeout if the wide search is intentional.`,
    })

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    // Only fail if exit code is 2 AND no output was produced
    if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = exitCode === 2

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    for (const line of lines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => null)
      if (!stats) continue
      if (InternalPath.contains(filePath)) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path, regex pattern, or include filter.)")
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
