import { Hono } from "hono"
import { adapter } from "#hono"

export { Database } from "./storage/db"
export { Log } from "./util/log"

declare const OPENCODE_VERSION: string | undefined

export namespace NodeBackend {
  export function create() {
    const app = new Hono()
    const runtime = adapter.create(app)

    app.get("/global/health", (c) =>
      c.json({ healthy: true, version: typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local" }),
    )
    app.get(
      "/runtime/ws",
      runtime.upgradeWebSocket(() => ({
        onMessage(event, ws) {
          ws.send(String(event.data))
        },
      })),
    )

    return { app, runtime }
  }

  export async function listen(opts: { port: number; hostname: string }) {
    const backend = create()
    const listener = await backend.runtime.listen(opts)
    const urlHostname = opts.hostname === "0.0.0.0" ? "127.0.0.1" : opts.hostname
    return {
      url: new URL(`http://${urlHostname}:${listener.port}`),
      hostname: opts.hostname,
      port: listener.port,
      stop(close?: boolean) {
        return listener.stop(close)
      },
    }
  }

  export async function probePtyAdapter() {
    const mod = await import("#pty")
    return typeof mod.spawn === "function"
  }

  export async function probePtySpawn() {
    const mod = await import("#pty")
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1]))
    const proc = mod.spawn(process.execPath, ["-e", "process.stdout.write('pty-ok')"], {
      name: "xterm-256color",
      cwd: process.cwd(),
      env,
    })
    return new Promise<boolean>((resolve, reject) => {
      let output = ""
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error("PTY spawn timeout"))
      }, 5000)
      proc.onData((data) => {
        output += data
      })
      proc.onExit(() => {
        clearTimeout(timeout)
        resolve(output.includes("pty-ok"))
      })
    })
  }
}
