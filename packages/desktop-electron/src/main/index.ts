import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Event } from "electron"
import { app, BrowserWindow, dialog } from "electron"
import pkg from "electron-updater"

import contextMenu from "electron-context-menu"
contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

// OCO: Electron app identity uses OCO names, IDs, and isolated user data
const APP_NAMES: Record<string, string> = {
  dev: "OpenCodeOrchestra Electron Dev",
  beta: "OpenCodeOrchestra Electron Beta",
  prod: "OpenCodeOrchestra Electron",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.orchestra.electron.dev",
  beta: "ai.opencode.orchestra.electron.beta",
  prod: "ai.opencode.orchestra.electron",
}
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : APP_NAMES.dev)
app.setPath(
  "userData",
  join(
    app.getPath("appData"),
    process.env.OCO_ELECTRON_USER_DATA_ID ?? (app.isPackaged ? APP_IDS[CHANNEL] : APP_IDS.dev),
  ),
)
const { autoUpdater } = pkg

import type { InitStep, ServerReadyData, SqliteMigrationProgress, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand, sendSqliteMigrationProgress } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { migrate } from "./migrate"
import { getDefaultServerUrl, getWslConfig, setDefaultServerUrl, setWslConfig, spawnLocalServer } from "./server"
import { createLoadingWindow, createMainWindow, setBackgroundColor, setDockIcon } from "./windows"

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

let mainWindow: BrowserWindow | null = null
let server: { stop(): void } | null = null
const loadingComplete = defer<void>()
let lastSqliteProgress: SqliteMigrationProgress | null = null

const pendingDeepLinks: string[] = []

const serverReady = defer<ServerReadyData>()
const logger = initLogging()

logger.log("app starting", {
  version: app.getVersion(),
  packaged: app.isPackaged,
})

setupApp()

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  // OCO: Electron accepts oco:// deep links from second instance and macOS
  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("oco://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    killSidecar()
  })

  app.on("will-quit", () => {
    killSidecar()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      killSidecar()
      app.exit(0)
    })
  }

  void app
    .whenReady()
    .then(async () => {
      app.setAsDefaultProtocolClient("oco")
      setDockIcon()
      setupAutoUpdater()
      migrate()
      await initialize()
    })
    .catch((error) => {
      void handleStartupFailure(error)
    })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

// OCO: gate main window on backend readiness with migration/loading overlay
async function initialize() {
  const needsMigration = needsSqliteMigration()
  const sqliteDone = needsMigration ? defer<void>() : undefined
  let overlay: BrowserWindow | null = null

  const port = await getSidecarPort()
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password =
    process.env.OCO_ELECTRON_SMOKE_PASSWORD ?? process.env.OPENCODE_ELECTRON_SMOKE_PASSWORD ?? randomUUID()

  // Install the migration listener BEFORE spawnLocalServer so we never miss the
  // first (or last) progress event — the in-process backend can finish migration
  // synchronously inside `spawnLocalServer` and a late listener would deadlock here.
  initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
    lastSqliteProgress = progress
    setInitStep({ phase: "sqlite_waiting" })
    if (overlay) sendSqliteMigrationProgress(overlay, progress)
    if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
    if (progress.type === "Done") sqliteDone?.resolve()
  })

  logger.log("starting local backend", { url })
  const { listener, health, mode } = await spawnLocalServer(hostname, port, password, (progress) => {
    initEmitter.emit("sqlite", progress)
  })
  logger.log("local backend started", { mode, url })
  server = listener
  const readyData = {
    url,
    username: "oco",
    password,
  }

  const loadingTask = (async () => {
    logger.log("local backend connection started", { url })

    if (needsMigration) {
      await sqliteDone?.promise
    }

    await Promise.race([
      health.wait,
      delay(30_000).then(() => {
        throw new Error(`Local backend health check timed out while starting ${mode} mode`)
      }),
    ])

    setInitStep({ phase: "done" })
    serverReady.resolve(readyData)
    logger.log("loading task finished")
  })()

  const globals = {
    updaterEnabled: UPDATER_ENABLED,
    deepLinks: pendingDeepLinks,
  }

  const showOverlay = await Promise.race([loadingTask.then(() => false), delay(1_000).then(() => true)])
  if (showOverlay) {
    overlay = createLoadingWindow(globals)
    if (lastSqliteProgress) sendSqliteMigrationProgress(overlay, lastSqliteProgress)
  }

  await loadingTask

  if (overlay) {
    if (lastSqliteProgress?.type === "Done") sendSqliteMigrationProgress(overlay, lastSqliteProgress)
    await Promise.race([loadingComplete.promise, delay(5_000)])
  }

  mainWindow = createMainWindow(globals)
  wireMenu()

  overlay?.close()
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      killSidecar()
      app.relaunch()
      app.exit(0)
    },
  })
}

registerIpcHandlers({
  killSidecar: () => killSidecar(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep)
    const listener = (step: InitStep) => sendStep(step)
    initEmitter.on("step", listener)
    try {
      logger.log("awaiting server ready")
      const res = await serverReady.promise
      logger.log("server ready", { url: res.url })
      return res
    } finally {
      initEmitter.off("step", listener)
    }
  },
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config: WslConfig) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => undefined,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
})

function killSidecar() {
  if (!server) return
  server.stop()
  server = null
}

async function handleStartupFailure(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  logger.error("startup failed", failure)
  serverReady.reject(failure)
  killSidecar()
  await dialog.showMessageBox({
    type: "error",
    title: "OpenCodeOrchestra Electron failed to start",
    message: "The local OCO backend could not start.",
    detail: `${failure.message}\n\nIf this is a packaged app, rebuild it so the backend bundle, native modules, and sidecar resources are included. To test the sidecar fallback intentionally, launch with OCO_ELECTRON_BACKEND=sidecar.`,
  })
  app.quit()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

// OCO: OCO_PORT pins Electron local backend port for smoke/dev runs
async function getSidecarPort() {
  const fromEnv = process.env.OCO_PORT ?? process.env.OPENCODE_PORT
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function sqliteFileExists() {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "oco", "oco.db"))
}

function legacyStorageDirExists() {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "oco", "storage"))
}

function needsSqliteMigration() {
  return !sqliteFileExists() && legacyStorageDirExists()
}

function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })
}

let updateReady = false

async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  updateReady = false
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("update metadata fetched", {
      releaseVersion: updateInfo?.version ?? null,
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      files: updateInfo?.files?.map((file) => file.url) ?? [],
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    logger.log("update available", { version })
    await autoUpdater.downloadUpdate()
    logger.log("update download completed", { version })
    updateReady = true
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

async function installUpdate() {
  if (!updateReady) return
  killSidecar()
  autoUpdater.quitAndInstall()
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    restartNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate()
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
