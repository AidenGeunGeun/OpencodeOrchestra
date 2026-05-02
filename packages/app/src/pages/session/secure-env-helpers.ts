// OCO-only file: Secure Env Tool Dock state helpers. See oco-dev skill deltas-catalog.md.

export type SecureEnvEntryRef = {
  id: string
  name: string
}

export function toggleSecureEnvSelection(selected: ReadonlySet<string>, id: string) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function selectAllSecureEnvVisible(entries: readonly SecureEnvEntryRef[]) {
  return new Set(entries.map((entry) => entry.id))
}

export function selectedSecureEnvEntries<T extends SecureEnvEntryRef>(
  entries: readonly T[],
  selected: ReadonlySet<string>,
) {
  return entries.filter((entry) => selected.has(entry.id))
}

export function removeSecureEnvIDs(selected: ReadonlySet<string>, ids: Iterable<string>) {
  const deleted = new Set(ids)
  return new Set([...selected].filter((id) => !deleted.has(id)))
}

export function secureEnvBulkDeleteResult(total: number, failed: number) {
  const failedCount = Math.max(0, Math.min(total, failed))
  return {
    total,
    deleted: total - failedCount,
    failed: failedCount,
    complete: failedCount === 0,
  }
}
