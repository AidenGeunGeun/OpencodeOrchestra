import { constants } from "node:fs"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"

type PackagedContext = {
  appOutDir: string
  electronPlatformName: string
}

const packageDir = join(import.meta.dirname, "..")
const req = createRequire(import.meta.url)

async function exists(path: string) {
  return await access(path)
    .then(() => true)
    .catch(() => false)
}

async function executable(path: string) {
  if (process.platform === "win32") return true
  return await access(path, constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

async function walk(root: string) {
  const files: string[] = []
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
        continue
      }
      files.push(full)
    }
  }
  await visit(root)
  return files
}

async function requirePath(path: string, message: string) {
  if (await exists(path)) return
  throw new Error(`${message}: ${path}`)
}

async function requireBundledMain(entry: string) {
  await requirePath(entry, "Electron bundled main process is missing")
  const entrySource = await readFile(entry, "utf8")
  if (entrySource.includes("virtual:opencode-server")) {
    throw new Error(`Electron main bundle still contains unresolved virtual:opencode-server import: ${entry}`)
  }
  if (!entrySource.includes("./chunks/")) {
    throw new Error(`Electron main bundle does not reference any backend chunk: ${entry}`)
  }
  const chunksDir = join(dirname(entry), "chunks")
  await requirePath(chunksDir, "Electron main chunks directory is missing")
  const chunkFiles = (await readdir(chunksDir)).filter((file) => file.endsWith(".js"))
  if (chunkFiles.length === 0) {
    throw new Error(`Electron main chunks directory has no JS chunks: ${chunksDir}`)
  }
  const markers = ["NodeBackend", "JsonToSqlite", "node:sqlite", "tree-sitter"]
  let totalSize = 0
  let chunkWithMarkers: string | undefined
  for (const file of chunkFiles) {
    const full = join(chunksDir, file)
    const info = await stat(full)
    totalSize += info.size
    if (chunkWithMarkers) continue
    const source = await readFile(full, "utf8")
    if (markers.every((marker) => source.includes(marker))) chunkWithMarkers = full
  }
  if (totalSize < 1_000_000) {
    throw new Error(
      `Electron main chunks are too small to contain the bundled backend (${totalSize} bytes): ${chunksDir}`,
    )
  }
  if (!chunkWithMarkers) {
    throw new Error(`No Electron main chunk contains all backend markers (${markers.join(", ")}): ${chunksDir}`)
  }
}

function moduleDir(name: string) {
  return dirname(req.resolve(`${name}/package.json`, { paths: [packageDir] }))
}

async function requireAnyNativeModule(names: string[]) {
  const errors: string[] = []
  for (const name of names) {
    const ok = await moduleHasNativeBinary(name).catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error))
      return false
    })
    if (ok) return
  }
  throw new Error(
    `Electron package dependencies are missing native binaries. Checked ${names.join(", ")}. ${errors.join("; ")}`,
  )
}

async function moduleHasNativeBinary(name: string) {
  const dir = moduleDir(name)
  const files = await walk(dir)
  if (files.some((file) => file.endsWith(".node"))) return true
  throw new Error(`No .node binary was found under ${dir}`)
}

function nodePtyPlatformPackage() {
  const platform = process.platform === "win32" ? "win32" : process.platform
  return `@lydell/node-pty-${platform}-${process.arch}`
}

function isHostPlatform(context: PackagedContext) {
  return context.electronPlatformName === process.platform
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to allocate a packaged smoke port"))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function authHeaders(password: string) {
  return { authorization: `Basic ${Buffer.from(`oco:${password}`).toString("base64")}` }
}

async function waitForHttp(url: URL, password: string) {
  const deadline = Date.now() + 30_000
  let lastError = "no response"
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    try {
      const res = await fetch(url, { headers: authHeaders(password), signal: AbortSignal.timeout(2_000) })
      if (res.ok) return
      lastError = `${res.status} ${await res.text()}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Timed out waiting for packaged Electron backend health: ${lastError}`)
}

async function smokeFetch(label: string, url: URL, init: RequestInit = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(
      `Packaged Electron ${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }
}

async function smokePackagedBackend(executable: string, mode: "in-process" | "sidecar") {
  await requirePath(executable, "Packaged Electron executable is missing; cannot run packaged backend smoke")

  const tmp = await mkdtemp(join(tmpdir(), "oco-electron-packaged-"))
  const project = join(tmp, "project")
  await mkdir(project, { recursive: true })
  const port = await getFreePort()
  const password = `packaged-smoke-${mode}`
  const base = new URL(`http://127.0.0.1:${port}`)
  const child = spawn(executable, [], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_DATA_HOME: join(tmp, "data"),
      XDG_CONFIG_HOME: join(tmp, "config"),
      XDG_CACHE_HOME: join(tmp, "cache"),
      XDG_STATE_HOME: join(tmp, "state"),
      OCO_ELECTRON_USER_DATA_ID: `ai.opencode.orchestra.electron.smoke.${mode}.${port}`,
      OCO_PORT: String(port),
      OCO_ELECTRON_SMOKE_PASSWORD: password,
      OCO_ELECTRON_BACKEND: mode === "sidecar" ? "sidecar" : "in-process",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    },
  })

  let output = ""
  child.stdout.on("data", (data) => {
    output = `${output}${data.toString()}`.slice(-8000)
  })
  child.stderr.on("data", (data) => {
    output = `${output}${data.toString()}`.slice(-8000)
  })

  try {
    const exit = new Promise<never>((_resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => {
        reject(
          new Error(
            `Packaged Electron app exited during ${mode} smoke (code ${code ?? "unknown"}, signal ${signal ?? "none"}). ${output}`,
          ),
        )
      })
    })
    exit.catch(() => undefined)

    await Promise.race([waitForHttp(new URL("/global/health", base), password), exit])

    const headers = { ...authHeaders(password), "x-opencode-directory": project }
    const sessionsUrl = new URL("/session", base)
    sessionsUrl.searchParams.set("directory", project)
    const sessionsRes = await smokeFetch("session listing", sessionsUrl, { headers })
    if (!sessionsRes.ok) throw new Error(`session listing status ${sessionsRes.status} ${await sessionsRes.text()}`)
    const sessions = await sessionsRes.json()
    if (!Array.isArray(sessions)) throw new Error("session listing payload mismatch")

    const ptyUrl = new URL("/pty", base)
    ptyUrl.searchParams.set("directory", project)
    const ptyRes = await smokeFetch("pty listing", ptyUrl, { headers })
    if (!ptyRes.ok) throw new Error(`pty listing status ${ptyRes.status} ${await ptyRes.text()}`)
    const pty = await ptyRes.json()
    if (!Array.isArray(pty)) throw new Error("pty listing payload mismatch")
  } finally {
    if (!child.killed) child.kill()
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {}
        resolve()
      }, 5_000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await rm(tmp, { recursive: true, force: true })
  }
}

export async function validatePrePackage() {
  await requireBundledMain(join(packageDir, "out", "main", "index.js"))
  await requirePath(join(packageDir, "out", "preload", "index.js"), "Electron preload bundle is missing")
  await requirePath(join(packageDir, "out", "renderer", "index.html"), "Electron renderer bundle is missing")

  const sidecar = join(packageDir, "resources", process.platform === "win32" ? "oco-cli.exe" : "oco-cli")
  await requirePath(sidecar, "Electron sidecar fallback binary is missing")
  if (!(await executable(sidecar))) throw new Error(`Electron sidecar fallback binary is not executable: ${sidecar}`)

  await requirePath(join(packageDir, "resources", "icons", "icon.icns"), "macOS Electron icon is missing")
  await requirePath(join(packageDir, "resources", "icons", "icon.ico"), "Windows Electron icon is missing")
  await requirePath(join(packageDir, "resources", "icons", "icon.png"), "Linux Electron icon is missing")

  await requireAnyNativeModule(["@lydell/node-pty", nodePtyPlatformPackage()])
}

async function packagedLayout(context: PackagedContext) {
  if (context.electronPlatformName !== "darwin") {
    const resources = join(context.appOutDir, "resources")
    const entries = await readdir(context.appOutDir, { withFileTypes: true }).catch(() => [])
    const executableEntry = entries.find(
      (entry) =>
        entry.isFile() &&
        (context.electronPlatformName === "win32" ? entry.name.endsWith(".exe") : !entry.name.includes(".")),
    )
    return {
      resources,
      executable: executableEntry
        ? join(context.appOutDir, executableEntry.name)
        : join(context.appOutDir, "OpenCodeOrchestra Electron Dev"),
    }
  }
  const entries = await readdir(context.appOutDir, { withFileTypes: true })
  const appDir = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  if (!appDir) throw new Error(`Electron macOS app bundle was not found under ${context.appOutDir}`)
  const bundle = join(context.appOutDir, appDir.name)
  const macosDir = join(bundle, "Contents", "MacOS")
  const binaries = await readdir(macosDir, { withFileTypes: true })
  const binary = binaries.find((entry) => entry.isFile())
  if (!binary) throw new Error(`Electron macOS executable was not found under ${macosDir}`)
  return { resources: join(bundle, "Contents", "Resources"), executable: join(macosDir, binary.name) }
}

export async function validatePackagedApp(context: PackagedContext) {
  const { resources, executable } = await packagedLayout(context)
  await requirePath(resources, "Electron packaged resources directory is missing")
  await requirePath(join(resources, "app.asar"), "Packaged Electron app.asar is missing")

  const unpacked = join(resources, "app.asar.unpacked")
  await requirePath(unpacked, "Packaged Electron app.asar.unpacked directory is missing")

  const files = await walk(unpacked)
  const normalized = files.map((file) => file.replaceAll("\\", "/"))
  if (!normalized.some((file) => file.includes("/@lydell/node-pty") && file.endsWith(".node"))) {
    throw new Error("Packaged Electron app is missing the unpacked @lydell/node-pty native module")
  }

  const sidecar = join(resources, context.electronPlatformName === "win32" ? "oco-cli.exe" : "oco-cli")
  await requirePath(sidecar, "Packaged Electron sidecar fallback binary is missing")
  const sidecarStat = await stat(sidecar)
  if (!sidecarStat.isFile()) throw new Error(`Packaged Electron sidecar fallback path is not a file: ${sidecar}`)

  if (process.env.OCO_ELECTRON_SKIP_PACKAGED_SMOKE === "1") {
    console.warn("Skipping packaged Electron backend smoke because OCO_ELECTRON_SKIP_PACKAGED_SMOKE=1")
    return
  }
  if (!isHostPlatform(context)) {
    console.warn(
      `Skipping packaged Electron backend smoke for ${context.electronPlatformName}; host platform is ${process.platform}`,
    )
    return
  }
  await smokePackagedBackend(executable, "in-process")
  await smokePackagedBackend(executable, "sidecar")
}
