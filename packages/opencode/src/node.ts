import "./node-bun-shim"
import { Server } from "./server/server"
import { JsonToSqlite } from "./storage/json-to-sqlite"

export { Database } from "./storage/db"
export { Log } from "./util/log"
export { Server } from "./server/server"
export { JsonToSqlite } from "./storage/json-to-sqlite"

export namespace NodeBackend {
  export function create() {
    return Server.App()
  }

  export async function migrate(opts: { onProgress?: (event: JsonToSqlite.Progress) => void } = {}) {
    return JsonToSqlite.run({ onProgress: opts.onProgress })
  }

  export async function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
    onMigrationProgress?: (event: JsonToSqlite.Progress) => void
  }) {
    await migrate({ onProgress: opts.onMigrationProgress })
    return Server.listen(opts)
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
