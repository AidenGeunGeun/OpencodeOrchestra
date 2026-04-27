import { app } from "electron"
import log from "electron-log/main.js"
import { homedir } from "node:os"
import { join } from "node:path"
import { CHANNEL } from "./constants"
import { migrateTauriData } from "./migrate-data"

// Resolve the directory where Tauri stored its .dat files for the given app identifier.
// Mirrors Tauri's AppLocalData / AppData resolution per OS.
function tauriDir(id: string) {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id)
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
  }
}

// The Tauri app identifier changes between dev/beta/prod builds.
const TAURI_APP_IDS: Record<string, string> = {
  dev: "ai.opencode.orchestra.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.orchestra",
}
function tauriAppId() {
  return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : TAURI_APP_IDS.dev
}

export function migrate() {
  return migrateTauriData({
    sourceDir: tauriDir(tauriAppId()),
    targetDir: app.getPath("userData"),
    logger: log,
  })
}
