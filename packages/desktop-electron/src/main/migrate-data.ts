import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const TAURI_MIGRATED_KEY = "tauriMigrated"
export const TAURI_MIGRATION_VERSION_KEY = "tauriMigrationVersion"
export const TAURI_MIGRATION_VERSION = "1.3.1"
export const SETTINGS_STORE_NAME = "opencode.settings"

type JsonObject = Record<string, unknown>

type Logger = {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export type TauriMigrationResult =
  | { status: "skipped-current"; version: string }
  | { status: "skipped-no-source"; sourceDir: string }
  | { status: "migrated"; files: number; sourceDir: string; targetDir: string }

export function migrateTauriData(opts: { sourceDir: string; targetDir: string; logger?: Logger }): TauriMigrationResult {
  const logger = opts.logger ?? console
  const settingsPath = join(opts.targetDir, SETTINGS_STORE_NAME)
  const settings = readJsonObject(settingsPath, logger) ?? {}
  const version = settings[TAURI_MIGRATION_VERSION_KEY]

  if (typeof version === "string" && compareMigrationVersion(version, TAURI_MIGRATION_VERSION) >= 0) {
    logger.log("tauri migration: already current, skipping", { version })
    return { status: "skipped-current", version }
  }

  if (!existsSync(opts.sourceDir)) {
    logger.log("tauri migration: no tauri data directory found, nothing to migrate", { dir: opts.sourceDir })
    return { status: "skipped-no-source", sourceDir: opts.sourceDir }
  }

  mkdirSync(opts.targetDir, { recursive: true })

  let files = 0
  for (const filename of readdirSync(opts.sourceDir).sort()) {
    if (!filename.endsWith(".dat")) continue
    if (migrateFile(opts.sourceDir, opts.targetDir, filename, logger)) files++
  }

  const nextSettings = readJsonObject(settingsPath, logger) ?? {}
  nextSettings[TAURI_MIGRATED_KEY] = true
  nextSettings[TAURI_MIGRATION_VERSION_KEY] = TAURI_MIGRATION_VERSION
  writeJsonObject(settingsPath, nextSettings)

  logger.log("tauri migration: complete", {
    files,
    version: TAURI_MIGRATION_VERSION,
    legacyMarker: settings[TAURI_MIGRATED_KEY],
  })
  return { status: "migrated", files, sourceDir: opts.sourceDir, targetDir: opts.targetDir }
}

function migrateFile(sourceDir: string, targetDir: string, filename: string, logger: Logger) {
  const sourcePath = join(sourceDir, filename)
  const source = readJsonObject(sourcePath, logger)
  if (!source) return false

  const storeName = storeNameForTauriDat(filename)
  const targetPath = join(targetDir, storeName)
  const existing = flattenStoreObject(readJsonObject(targetPath, logger) ?? {})
  const merged = mergeMigratedData(existing, source)

  writeJsonObject(targetPath, merged)
  logger.log("tauri migration: migrated", filename, "->", storeName, {
    sourceKeys: Object.keys(source).length,
    preservedElectronKeys: Object.keys(existing).filter((key) => !(key in source)).length,
  })
  return true
}

export function storeNameForTauriDat(filename: string) {
  return filename === "opencode.settings.dat" ? SETTINGS_STORE_NAME : filename
}

export function mergeMigratedData(existing: JsonObject, source: JsonObject) {
  // 1.3.0 often wrote default-looking but non-empty values before migration ran.
  // Import Tauri over those defaults, but keep clearly customized Electron data.
  const merged: JsonObject = { ...existing }

  for (const [key, value] of Object.entries(source)) {
    merged[key] = mergeMigratedValue(key, value, existing[key])
  }

  return merged
}

function mergeMigratedValue(key: string, source: unknown, existing: unknown) {
  if (existing === undefined || existing === null) return source
  if (stableStringify(existing) === stableStringify(source)) return source

  if (typeof source === "string" && typeof existing === "string") {
    if (key === "globalSync.project") return mergeProjectListString(source, existing)
    if (key === "prompt-history" || key === "prompt-history-shell") {
      return mergeJsonArrayString(source, existing, "entries")
    }
    if (key === "workspace:icon" || key === "workspace:project") return mergeWorkspaceProjectString(source, existing)
    if (key === "settings.v3" && isDefaultSettingsString(existing)) return source
    if (key === "layout" && isDefaultLayoutString(existing, source)) return source
    if (isDefaultJsonString(existing)) return source
  }

  if (isDefaultValue(existing)) return source
  return existing
}

export function flattenStoreObject(value: JsonObject) {
  const result: JsonObject = {}

  const visit = (prefix: string, next: unknown) => {
    if (isPlainObject(next)) {
      const entries = Object.entries(next)
      if (entries.length === 0) {
        result[prefix] = next
        return
      }
      for (const [key, child] of entries) visit(prefix ? `${prefix}.${key}` : key, child)
      return
    }

    result[prefix] = next
  }

  for (const [key, next] of Object.entries(value)) visit(key, next)
  return result
}

function mergeJsonArrayString(source: string, existing: string, arrayKey: string) {
  const sourceData = parseJsonObject(source)
  const existingData = parseJsonObject(existing)
  const sourceList = sourceData?.[arrayKey]
  const existingList = existingData?.[arrayKey]
  if (!Array.isArray(sourceList) || !Array.isArray(existingList)) return source

  const seen = new Set(sourceList.map(stableStringify))
  const extra = existingList.filter((entry) => {
    const serialized = stableStringify(entry)
    if (seen.has(serialized)) return false
    seen.add(serialized)
    return true
  })

  return JSON.stringify({ ...sourceData, [arrayKey]: [...sourceList, ...extra] })
}

function mergeProjectListString(source: string, existing: string) {
  const sourceData = parseJsonObject(source)
  const existingData = parseJsonObject(existing)
  const sourceList = sourceData?.value
  const existingList = existingData?.value
  if (!Array.isArray(sourceList) || !Array.isArray(existingList)) {
    return isDefaultJsonString(existing) ? source : existing
  }

  const seen = new Set(sourceList.map(projectIdentity))
  const extra = existingList.filter((entry) => {
    const identity = projectIdentity(entry)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })

  return JSON.stringify({ ...sourceData, value: [...sourceList, ...extra] })
}

function mergeWorkspaceProjectString(source: string, existing: string) {
  if (source.includes("data:image") && !existing.includes("data:image")) return source
  if (isDefaultJsonString(existing)) return source
  return existing
}

function projectIdentity(value: unknown) {
  if (isPlainObject(value)) {
    const worktree = value.worktree
    if (typeof worktree === "string") return `worktree:${worktree}`
    const id = value.id
    if (typeof id === "string") return `id:${id}`
  }
  return stableStringify(value)
}

function isDefaultSettingsString(value: string) {
  const parsed = parseJsonObject(value)
  return !!parsed && stableStringify(parsed) === stableStringify(DEFAULT_SETTINGS)
}

function isDefaultLayoutString(existing: string, source: string) {
  const existingLayout = parseJsonObject(existing)
  const sourceLayout = parseJsonObject(source)
  if (!existingLayout || !sourceLayout) return false
  const existingWorkspaces = getPath(existingLayout, ["sidebar", "workspaces"])
  const sourceWorkspaces = getPath(sourceLayout, ["sidebar", "workspaces"])
  return isEmptyPlainObject(existingWorkspaces) && !isEmptyPlainObject(sourceWorkspaces)
}

function isDefaultJsonString(value: string) {
  const parsed = parseJsonObject(value)
  return parsed !== undefined && isDefaultValue(parsed)
}

function isDefaultValue(value: unknown): boolean {
  if (value === "") return true
  if (Array.isArray(value)) return value.length === 0
  if (!isPlainObject(value)) return false
  const entries = Object.values(value)
  if (entries.length === 0) return true
  if ("value" in value && Array.isArray(value.value) && value.value.length === 0) return true
  if ("entries" in value && Array.isArray(value.entries) && value.entries.length === 0) return true
  return entries.every(isDefaultValue)
}

function isEmptyPlainObject(value: unknown) {
  return isPlainObject(value) && Object.keys(value).length === 0
}

function getPath(value: JsonObject, path: string[]) {
  let current: unknown = value
  for (const part of path) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

function readJsonObject(path: string, logger: Logger) {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"))
    if (isPlainObject(parsed)) return parsed
    logger.warn("tauri migration: expected JSON object", path)
  } catch (err) {
    logger.warn("tauri migration: failed to parse", path, err)
  }
  return undefined
}

function writeJsonObject(path: string, data: JsonObject) {
  writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`)
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function compareMigrationVersion(a: string, b: string) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10))
  const right = b.split(".").map((part) => Number.parseInt(part, 10))
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const nextLeft = Number.isNaN(left[i]) ? 0 : (left[i] ?? 0)
    const nextRight = Number.isNaN(right[i]) ? 0 : (right[i] ?? 0)
    if (nextLeft !== nextRight) return nextLeft - nextRight
  }
  return 0
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
