import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join } from "node:path"
import { app } from "electron"
import type { SqliteMigrationProgress } from "../preload/types"
import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { getUserShell, loadShellEnv } from "./shell-env"
import { store } from "./store"

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

type ServerProcess = { stop(): void }

export function getDefaultServerUrl(): string | null {
  const value = store.get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    store.set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  store.delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = store.get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  store.set(WSL_ENABLED_KEY, config.enabled)
}

export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  onSqliteMigrationProgress?: (progress: SqliteMigrationProgress) => void,
) {
  const env = prepareServerEnv(password)
  const listener = spawnServerProcess(hostname, port, env, onSqliteMigrationProgress)

  const wait = (async () => {
    const url = `http://${hostname}:${port}`

    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) return
      }
    }

    await ready()
  })()

  return { listener, health: { wait } }
}

function prepareServerEnv(password: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? (loadShellEnv(shell) ?? {}) : {}
  const env = {
    ...process.env,
    ...shellEnv,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    OPENCODE_SERVER_USERNAME: "oco",
    OPENCODE_SERVER_PASSWORD: password,
    XDG_STATE_HOME: app.getPath("userData"),
  }
  Object.assign(process.env, env)
  return env
}

function spawnServerProcess(
  hostname: string,
  port: number,
  env: NodeJS.ProcessEnv,
  onSqliteMigrationProgress?: (progress: SqliteMigrationProgress) => void,
): ServerProcess {
  let child: ChildProcessWithoutNullStreams
  if (app.isPackaged) {
    const binary = process.platform === "win32" ? "oco-cli.exe" : "oco-cli"
    child = spawn(join(process.resourcesPath, binary), ["serve", "--hostname", hostname, "--port", String(port)], {
      env,
      stdio: "pipe",
    })
  } else {
    child = spawn("bun", ["run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", hostname, "--port", String(port)], {
      cwd: join(process.cwd(), "../opencode"),
      env,
      stdio: "pipe",
    })
  }

  child.stdout.on("data", (data) => process.stdout.write(data))
  let stderr = ""
  child.stderr.on("data", (data) => {
    const text = data.toString()
    process.stderr.write(text)
    stderr += text
    const lines = stderr.split(/\r?\n/)
    stderr = lines.pop() ?? ""
    for (const line of lines) {
      const match = /^sqlite-migration:(\d+)$/.exec(line.trim())
      if (match) {
        onSqliteMigrationProgress?.({ type: "InProgress", value: Number(match[1]) })
        continue
      }
      if (line.trim() === "sqlite-migration:done") onSqliteMigrationProgress?.({ type: "Done" })
    }
  })

  return {
    stop() {
      if (child.killed) return
      child.kill()
    },
  }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`oco:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
