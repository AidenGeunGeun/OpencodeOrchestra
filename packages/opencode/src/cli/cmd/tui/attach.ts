import { cmd } from "../cmd"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import os from "node:os"
import path from "node:path"

function remapAbsoluteDirectory(input: string, from: string, to: string) {
  const relative = path.relative(from, input)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return
  return relative ? path.join(to, relative) : to
}

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      const headers = (() => {
        const password = args.password ?? process.env.OPENCODE_SERVER_PASSWORD
        if (!password) return undefined
        const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()
      const directory = await (async () => {
        if (!args.dir) return undefined
        try {
          const sdk = createOpencodeClient({
            baseUrl: args.url,
            directory: args.dir,
            headers,
          })
          const result = await sdk.path.get()
          let resolved = result.data?.directory ?? args.dir
          if (!result.data || !path.isAbsolute(args.dir) || resolved !== args.dir) return resolved

          const base = createOpencodeClient({
            baseUrl: args.url,
            headers,
          })
          const baseResult = await base.path.get()
          if (!baseResult.data) return resolved

          const candidates = [
            remapAbsoluteDirectory(args.dir, os.homedir(), baseResult.data.home),
            remapAbsoluteDirectory(args.dir, process.cwd(), baseResult.data.directory),
          ].filter((item): item is string => !!item && item !== resolved)

          for (const candidate of candidates) {
            try {
              const next = await createOpencodeClient({
                baseUrl: args.url,
                directory: candidate,
                headers,
              }).path.get()
              resolved = next.data?.directory ?? candidate
              break
            } catch {
              continue
            }
          }

          return resolved
        } catch {
          return args.dir
        }
      })()
      await tui({
        url: args.url,
        args: { sessionID: args.session },
        directory,
        headers,
      })
    } finally {
      unguard?.()
    }
  },
})
