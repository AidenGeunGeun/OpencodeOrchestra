import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import {
  DEFAULT_WAIT_FOR_CHILDREN_TIMEOUT_MS,
  RunChildSessionTracker,
  createWaitForChildrenTimeoutResult,
} from "./run-wait"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running opencode server (e.g., http://localhost:4096)",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("wait-for-children", {
        type: "boolean",
        default: true,
        describe: "wait for persistent child sessions before exiting",
      })
      .option("wait-for-children-timeout", {
        type: "number",
        default: DEFAULT_WAIT_FOR_CHILDREN_TIMEOUT_MS,
        describe: "maximum milliseconds to wait for persistent child sessions",
      })
  },
  handler: async (args) => {
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => {})
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    const waitForChildren = args["wait-for-children"] !== false
    const waitForChildrenTimeout = Number(args["wait-for-children-timeout"] ?? DEFAULT_WAIT_FOR_CHILDREN_TIMEOUT_MS)
    if (waitForChildren && (!Number.isFinite(waitForChildrenTimeout) || waitForChildrenTimeout < 0)) {
      UI.error("--wait-for-children-timeout must be a non-negative number of milliseconds")
      process.exit(1)
    }

    const execute = async (sdk: OpencodeClient, sessionID: string) => {
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const eventAbort = new AbortController()
      const events = await sdk.event.subscribe({}, { signal: eventAbort.signal })
      let errorMsg: string | undefined
      let exitCode = 0
      let timedOut = false
      let waitTimeout: ReturnType<typeof setTimeout> | undefined
      const childTracker = new RunChildSessionTracker(sessionID, waitForChildren)
      const persistentAgentCache = new Map<string, Promise<boolean>>()

      const isPersistentAgent = (agentID: string | null | undefined) => {
        if (!agentID) return Promise.resolve(false)
        const cached = persistentAgentCache.get(agentID)
        if (cached) return cached
        const result = Agent.get(agentID)
          .then((agent) => agent?.singleShot === false)
          .catch(() => false)
        persistentAgentCache.set(agentID, result)
        return result
      }

      const startWaitTimeout = () => {
        if (!waitForChildren || waitTimeout) return
        waitTimeout = setTimeout(() => {
          const result = createWaitForChildrenTimeoutResult(childTracker)
          timedOut = true
          exitCode = result.exitCode
          errorMsg = errorMsg ? errorMsg + EOL + result.message : result.message
          const error = {
            name: "WaitForChildrenTimeout",
            message: result.message,
            data: {
              childSessionIDs: result.childSessionIDs,
            },
          }
          if (!outputJsonEvent("error", { error })) UI.error(result.message)
          eventAbort.abort()
        }, waitForChildrenTimeout)
      }

      const eventProcessor = (async () => {
        try {
          for await (const event of events.stream) {
            if (event.type === "message.part.updated") {
              const part = event.properties.part
              childTracker.observeRootActivity(part.sessionID)
              if (part.sessionID !== sessionID) continue

              if (part.type === "tool" && part.state.status === "completed") {
                if (outputJsonEvent("tool_use", { part })) continue
                const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
                const title =
                  part.state.title ||
                  (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
                printEvent(color, tool, title)
                if (part.tool === "bash" && part.state.output?.trim()) {
                  UI.println()
                  UI.println(part.state.output)
                }
              }

              if (part.type === "step-start") {
                if (outputJsonEvent("step_start", { part })) continue
              }

              if (part.type === "step-finish") {
                if (outputJsonEvent("step_finish", { part })) continue
              }

              if (part.type === "text" && part.time?.end) {
                if (outputJsonEvent("text", { part })) continue
                const isPiped = !process.stdout.isTTY
                if (!isPiped) UI.println()
                process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
                if (!isPiped) UI.println()
              }
            }

            if (event.type === "session.status") {
              const props = event.properties
              childTracker.observeSessionStatus(props.sessionID, props.status.type)
              if (childTracker.shouldExit()) break
            }

            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID || !props.error) continue
              let err = String(props.error.name)
              if ("data" in props.error && props.error.data && "message" in props.error.data) {
                err = String(props.error.data.message)
              }
              errorMsg = errorMsg ? errorMsg + EOL + err : err
              if (outputJsonEvent("error", { error: props.error })) continue
              UI.error(err)
            }

            if (event.type === "session.idle") {
              childTracker.observeSessionIdle(event.properties.sessionID)
              if (childTracker.shouldExit()) break
            }

            if (event.type === "session.created") {
              const info = event.properties.info
              if (childTracker.hasSession(info.parentID)) {
                const persistent = info.parentID === sessionID && (await isPersistentAgent(info.agentID))
                if (childTracker.observeSessionCreated(info, persistent)) startWaitTimeout()
              }
            }

            if (event.type === "permission.asked") {
              const permission = event.properties
              if (!childTracker.hasSession(permission.sessionID)) continue
              const result = await select({
                message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
                options: [
                  { value: "once", label: "Allow once" },
                  { value: "always", label: "Always allow: " + permission.always.join(", ") },
                  { value: "reject", label: "Reject" },
                ],
                initialValue: "once",
              }).catch(() => "reject")
              const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
              await sdk.permission.respond({
                sessionID,
                permissionID: permission.id,
                response,
              })
            }
          }
        } catch (error) {
          if (!timedOut) throw error
        } finally {
          if (waitTimeout) clearTimeout(waitTimeout)
        }
      })()

      // Validate agent if specified
      const resolvedAgent = await (async () => {
        if (!args.agent) return undefined
        const agent = await Agent.get(args.agent)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return args.agent
      })()

      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent: resolvedAgent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
      } else {
        const modelParam = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent: resolvedAgent,
          model: modelParam,
          variant: args.variant,
          parts: [...fileParts, { type: "text", text: message }],
        })
      }

      await eventProcessor
      if (errorMsg) process.exit(exitCode || 1)
    }

    if (args.attach) {
      const sdk = createOpencodeClient({ baseUrl: args.attach })

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? {
                title,
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              }
            : {
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      return await execute(sdk, sessionID)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const password = Flag.OPENCODE_SERVER_PASSWORD
        if (password && !request.headers.has("authorization")) {
          const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
          request.headers.set("authorization", `Basic ${btoa(`${username}:${password}`)}`)
        }
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      if (args.command) {
        const exists = await Command.get(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? {
                title,
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              }
            : {
                permission: [
                  {
                    permission: "question",
                    action: "deny",
                    pattern: "*",
                  },
                ],
              },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await execute(sdk, sessionID)
    })
  },
})
