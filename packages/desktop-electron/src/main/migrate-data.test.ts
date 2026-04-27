import { afterEach, describe, expect, test } from "bun:test"
import Store from "electron-store"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TAURI_MIGRATION_VERSION, migrateTauriData } from "./migrate-data"

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("Tauri data migration", () => {
  test("migrates flat dotted Tauri keys and workspace thumbnails into Electron stores", () => {
    const source = tempDir()
    const target = tempDir()
    writeJson(source, "opencode.global.dat", {
      layout: JSON.stringify({ sidebar: { opened: true, width: 320 } }),
      "layout.page": JSON.stringify({ lastProjectSession: { "/repo": { id: "ses_tauri" } } }),
      "globalSync.project": JSON.stringify({ value: [{ worktree: "/repo", icon: { type: "emoji", value: "x" } }] }),
      "command.catalog.v1": JSON.stringify({ command: { title: "Run" } }),
    })
    writeJson(source, "default.dat", {
      "settings.v3": JSON.stringify({ general: { sound: true }, keybinds: { leader: "ctrl+x" } }),
    })
    writeJson(source, "opencode.settings.dat", { defaultServerUrl: "sidecar", skipLocalServer: false })
    writeJson(source, "opencode.workspace.repo.dat", {
      "workspace:icon": "data:image/png;base64,custom-thumbnail",
      "workspace:project": JSON.stringify({ name: "Repo" }),
    })

    const result = migrateTauriData({ sourceDir: source, targetDir: target, logger: quietLogger })

    expect(result.status).toBe("migrated")
    expect(store(target, "opencode.global.dat").get("layout")).toBe(
      JSON.stringify({ sidebar: { opened: true, width: 320 } }),
    )
    expect(store(target, "opencode.global.dat").get("layout.page")).toBe(
      JSON.stringify({ lastProjectSession: { "/repo": { id: "ses_tauri" } } }),
    )
    expect(store(target, "opencode.global.dat").get("globalSync.project")).toBe(
      JSON.stringify({ value: [{ worktree: "/repo", icon: { type: "emoji", value: "x" } }] }),
    )
    expect(store(target, "opencode.global.dat").get("command.catalog.v1")).toBe(
      JSON.stringify({ command: { title: "Run" } }),
    )
    expect(store(target, "default.dat").get("settings.v3")).toBe(
      JSON.stringify({ general: { sound: true }, keybinds: { leader: "ctrl+x" } }),
    )
    expect(store(target, "opencode.workspace.repo.dat").get("workspace:icon")).toBe(
      "data:image/png;base64,custom-thumbnail",
    )
    expect(store(target, "opencode.settings").get("tauriMigrationVersion")).toBe(TAURI_MIGRATION_VERSION)
    expect(store(target, "opencode.settings").get("tauriMigrated")).toBe(true)
  })

  test("recovers broken 1.3.0 nested state while preserving Electron-only data", () => {
    const source = tempDir()
    const target = tempDir()
    writeJson(source, "opencode.global.dat", {
      layout: JSON.stringify({ sidebar: { opened: true, workspaces: { "/repo": true } } }),
      "globalSync.project": JSON.stringify({ value: [{ worktree: "/repo" }, { worktree: "/other" }] }),
      "prompt-history": JSON.stringify({ entries: [{ prompt: [{ type: "text", content: "from tauri" }] }] }),
    })
    writeJson(source, "default.dat", {
      "settings.v3": JSON.stringify({ ...DEFAULT_SETTINGS, appearance: { fontSize: 16, font: "tauri-font" } }),
    })
    writeJson(source, "opencode.workspace.repo.dat", {
      "workspace:icon": "data:image/png;base64,tauri-thumbnail",
      "workspace:project": JSON.stringify({
        value: { icon: { override: "data:image/png;base64,project-thumbnail" } },
      }),
    })
    writeJson(target, "opencode.settings", { tauriMigrated: true })
    writeJson(target, "opencode.global.dat", {
      globalSync: { project: JSON.stringify({ value: [{ worktree: "/new-electron-project" }] }) },
      layout: JSON.stringify({ sidebar: { opened: false, workspaces: {} } }),
      "prompt-history": JSON.stringify({ entries: [{ prompt: [{ type: "text", content: "typed in electron" }] }] }),
      "electron-only": "keep me",
    })
    writeJson(target, "default.dat", {
      "settings.v3": JSON.stringify(DEFAULT_SETTINGS),
    })
    writeJson(target, "opencode.workspace.repo.dat", {
      "workspace:project": JSON.stringify({ value: { icon: { color: "blue" } } }),
      "session:ses_new:prompt": JSON.stringify({ text: "typed during 1.3.0" }),
    })

    migrateTauriData({ sourceDir: source, targetDir: target, logger: quietLogger })

    const global = store(target, "opencode.global.dat")
    expect(global.get("globalSync.project")).toBe(
      JSON.stringify({
        value: [{ worktree: "/repo" }, { worktree: "/other" }, { worktree: "/new-electron-project" }],
      }),
    )
    expect(global.get("layout")).toBe(
      JSON.stringify({ sidebar: { opened: true, workspaces: { "/repo": true } } }),
    )
    expect(global.get("electron-only")).toBe("keep me")
    expect(global.get("globalSync")).toBeUndefined()
    expect(global.get("prompt-history")).toContain("from tauri")
    expect(global.get("prompt-history")).toContain("typed in electron")
    expect(store(target, "opencode.workspace.repo.dat").get("workspace:icon")).toBe(
      "data:image/png;base64,tauri-thumbnail",
    )
    expect(store(target, "opencode.workspace.repo.dat").get("workspace:project")).toBe(
      JSON.stringify({ value: { icon: { override: "data:image/png;base64,project-thumbnail" } } }),
    )
    expect(store(target, "opencode.workspace.repo.dat").get("session:ses_new:prompt")).toBe(
      JSON.stringify({ text: "typed during 1.3.0" }),
    )
    expect(store(target, "default.dat").get("settings.v3")).toBe(
      JSON.stringify({ ...DEFAULT_SETTINGS, appearance: { fontSize: 16, font: "tauri-font" } }),
    )
  })

  test("preserves customized same-key Electron values during recovery", () => {
    const source = tempDir()
    const target = tempDir()
    writeJson(source, "default.dat", {
      "settings.v3": JSON.stringify({ ...DEFAULT_SETTINGS, appearance: { fontSize: 18, font: "tauri-font" } }),
    })
    writeJson(source, "opencode.workspace.repo.dat", {
      "session:ses_existing:prompt": JSON.stringify({ text: "tauri prompt" }),
    })
    writeJson(target, "opencode.settings", { tauriMigrated: true })
    writeJson(target, "default.dat", {
      "settings.v3": JSON.stringify({ ...DEFAULT_SETTINGS, appearance: { fontSize: 20, font: "electron-font" } }),
    })
    writeJson(target, "opencode.workspace.repo.dat", {
      "session:ses_existing:prompt": JSON.stringify({ text: "typed during broken electron session" }),
    })

    migrateTauriData({ sourceDir: source, targetDir: target, logger: quietLogger })

    expect(store(target, "default.dat").get("settings.v3")).toBe(
      JSON.stringify({ ...DEFAULT_SETTINGS, appearance: { fontSize: 20, font: "electron-font" } }),
    )
    expect(store(target, "opencode.workspace.repo.dat").get("session:ses_existing:prompt")).toBe(
      JSON.stringify({ text: "typed during broken electron session" }),
    )
  })

  test("does not write anything for a pure Electron install with no Tauri source", () => {
    const source = join(tempDir(), "missing-tauri")
    const target = tempDir()

    const result = migrateTauriData({ sourceDir: source, targetDir: target, logger: quietLogger })

    expect(result.status).toBe("skipped-no-source")
    expect(existsSync(join(target, "opencode.settings"))).toBe(false)
  })

  test("skips current or newer migration markers", () => {
    const source = tempDir()
    const target = tempDir()
    writeJson(source, "opencode.global.dat", { layout: "from-tauri" })
    writeJson(target, "opencode.settings", { tauriMigrationVersion: "1.3.2" })
    writeJson(target, "opencode.global.dat", { layout: "already-migrated" })

    const result = migrateTauriData({ sourceDir: source, targetDir: target, logger: quietLogger })

    expect(result.status).toBe("skipped-current")
    expect(store(target, "opencode.global.dat").get("layout")).toBe("already-migrated")
  })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "oco-tauri-migration-"))
  temps.push(dir)
  return dir
}

function writeJson(dir: string, name: string, data: Record<string, unknown>) {
  writeFileSync(join(dir, name), `${JSON.stringify(data, null, "\t")}\n`)
}

function store(cwd: string, name: string) {
  return new Store({ cwd, name, fileExtension: "", accessPropertiesByDotNotation: false })
}

const quietLogger = {
  log: () => undefined,
  warn: () => undefined,
}

const DEFAULT_SETTINGS = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showReasoningSummaries: false,
    shellToolPartsExpanded: true,
    editToolPartsExpanded: false,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    font: "ibm-plex-mono",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}
