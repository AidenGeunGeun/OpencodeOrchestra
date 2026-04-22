import { mock } from "bun:test"

type ExportSnapshot = Record<string, Record<string, unknown>>

function snapshotExport(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  return { ...(value as Record<string, unknown>) }
}

export async function createModuleMockRestorer(paths: string[]) {
  const snapshots = new Map<string, ExportSnapshot>()

  for (const modulePath of paths) {
    const module = (await import(modulePath)) as Record<string, unknown>
    const snapshot: ExportSnapshot = {}

    for (const [exportName, exportValue] of Object.entries(module)) {
      const exportSnapshot = snapshotExport(exportValue)
      if (exportSnapshot) snapshot[exportName] = exportSnapshot
    }

    snapshots.set(modulePath, snapshot)
  }

  return async function restoreModuleMocks() {
    mock.restore()

    for (const [modulePath, snapshot] of snapshots) {
      const currentModule = (await import(modulePath)) as Record<string, unknown>

      for (const [exportName, exportSnapshot] of Object.entries(snapshot)) {
        const currentExport = currentModule[exportName]
        if (!currentExport || typeof currentExport !== "object") continue

        const currentRecord = currentExport as Record<string, unknown>

        for (const key of Object.keys(currentRecord)) {
          if (!(key in exportSnapshot)) delete currentRecord[key]
        }

        Object.assign(currentRecord, exportSnapshot)
      }
    }
  }
}
