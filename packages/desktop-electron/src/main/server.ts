import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import type { SqliteMigrationProgress } from "../preload/types"
import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

type ServerProcess = { stop(): void; failure?: Promise<never> }
type BackendMode = "in-process" | "sidecar"
type NodeBackendModule = {
  NodeBackend: {
    probePtyAdapter?(): Promise<boolean>
    listen(opts: {
      hostname: string
      port: number
      onMigrationProgress?: (event: { current: number; total: number; label: string }) => void
    }): Promise<{ stop(close?: boolean): void | Promise<void> }>
  }
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = getStore().get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  getStore().set(WSL_ENABLED_KEY, config.enabled)
}

// OCO: Electron can use in-process backend or packaged oco-cli sidecar
export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  onSqliteMigrationProgress?: (progress: SqliteMigrationProgress) => void,
) {
  const env = prepareServerEnv(password)
  const mode = resolveBackendMode()
  const listener =
    mode === "sidecar"
      ? spawnServerProcess(hostname, port, env, onSqliteMigrationProgress)
      : await startInProcessServer(hostname, port, onSqliteMigrationProgress)

  const wait = (async () => {
    const url = `http://${hostname}:${port}`

    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) return
      }
    }

    const checks: Promise<void>[] = [ready()]
    if (listener.failure) checks.push(listener.failure)
    await Promise.race(checks)
  })()

  return { listener, health: { wait }, mode }
}

function resolveBackendMode(): BackendMode {
  const value = (process.env.OCO_ELECTRON_BACKEND ?? process.env.OPENCODE_ELECTRON_BACKEND ?? "").toLowerCase()
  if (value === "sidecar" || value === "managed-sidecar") return "sidecar"
  if (value === "in-process" || value === "inprocess" || value === "node") return "in-process"
  if (process.env.OCO_ELECTRON_USE_SIDECAR === "1" || process.env.OPENCODE_ELECTRON_USE_SIDECAR === "1")
    return "sidecar"
  return "in-process"
}

// OCO: local Electron backend uses oco Basic auth and OCO state directory
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

// OCO: sidecar fallback resolves packaged oco-cli before spawning serve
function spawnServerProcess(
  hostname: string,
  port: number,
  env: NodeJS.ProcessEnv,
  onSqliteMigrationProgress?: (progress: SqliteMigrationProgress) => void,
): ServerProcess {
  let child: ChildProcessWithoutNullStreams
  if (app.isPackaged) {
    const binary = process.platform === "win32" ? "oco-cli.exe" : "oco-cli"
    const binaryPath = join(process.resourcesPath, binary)
    if (!existsSync(binaryPath)) {
      throw new Error(
        `Electron sidecar fallback binary is missing at ${binaryPath}. Rebuild the Electron package so resources/oco-cli is included, or unset OCO_ELECTRON_BACKEND=sidecar to use the in-process backend.`,
      )
    }
    child = spawn(binaryPath, ["serve", "--hostname", hostname, "--port", String(port)], {
      env,
      stdio: "pipe",
    })
  } else {
    child = spawn(
      "bun",
      ["run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", hostname, "--port", String(port)],
      {
        cwd: join(process.cwd(), "../opencode"),
        env,
        stdio: "pipe",
      },
    )
  }

  child.stdout.on("data", (data) => process.stdout.write(data))
  let stderr = ""
  let stderrTail = ""
  child.stderr.on("data", (data) => {
    const text = data.toString()
    process.stderr.write(text)
    stderrTail = `${stderrTail}${text}`.slice(-4000)
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

  const failure = new Promise<never>((_resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`Electron sidecar fallback failed to start: ${error.message}`))
    })
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Electron sidecar fallback exited before backend readiness (code ${code ?? "unknown"}, signal ${signal ?? "none"}).${stderrTail ? ` Last stderr: ${stderrTail}` : ""}`,
        ),
      )
    })
  })
  failure.catch(() => undefined)

  return {
    failure,
    stop() {
      if (child.killed) return
      child.kill()
    },
  }
}

// OCO: default Electron backend imports the bundled Node server chunk
async function startInProcessServer(
  hostname: string,
  port: number,
  onSqliteMigrationProgress?: (progress: SqliteMigrationProgress) => void,
): Promise<ServerProcess> {
  const listener = await import("virtual:opencode-server")
    .then(async (mod) => {
      const backendModule = mod as NodeBackendModule
      if (app.isPackaged && backendModule.NodeBackend.probePtyAdapter) {
        const ptyReady = await backendModule.NodeBackend.probePtyAdapter()
        if (!ptyReady) throw new Error("Packaged PTY native adapter probe failed")
      }
      return backendModule.NodeBackend.listen({
        hostname,
        port,
        onMigrationProgress(event) {
          const percent = Math.floor((event.current / event.total) * 100)
          onSqliteMigrationProgress?.({ type: "InProgress", value: percent })
        },
      })
    })
    .catch((error) => {
      throw new Error(
        "Electron in-process backend failed to start from the bundled main process. This usually means the packaged app is missing a native dependency such as @lydell/node-pty or @parcel/watcher, or that node:sqlite is unavailable in this Node runtime.",
        { cause: error },
      )
    })
  onSqliteMigrationProgress?.({ type: "Done" })
  return {
    stop() {
      void listener.stop(true)
    },
  }
}

// OCO: health checks authenticate with the local oco username
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
