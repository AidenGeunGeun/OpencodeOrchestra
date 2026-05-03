// OCO-only file: gated performance diagnostics for Electron project switching.

type PerfFields = Record<string, unknown>

const FLAG_KEY = "oco.perf"
const QUERY_KEY = "oco_perf"

function round(value: number) {
  return Math.round(value * 10) / 10
}

export function isPerfEnabled() {
  if (typeof window === "undefined") return false
  const global = window as Window & { __OPENCODE__?: { perf?: boolean } }
  if (global.__OPENCODE__?.perf) return true

  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get(QUERY_KEY) === "1" || params.get(QUERY_KEY) === "true") return true
  } catch {}

  try {
    const value = window.localStorage.getItem(FLAG_KEY)
    return value === "1" || value === "true"
  } catch {
    return false
  }
}

export function perfLog(label: string, fields: PerfFields = {}) {
  if (!isPerfEnabled()) return
  console.info(`[oco-perf] ${label}`, fields)
}

export function perfDuration(start: number) {
  return round(performance.now() - start)
}

export async function perfMeasure<T>(label: string, fn: () => Promise<T>, fields: PerfFields = {}) {
  if (!isPerfEnabled()) return fn()
  const start = performance.now()
  try {
    const result = await fn()
    perfLog(label, { ...fields, durationMs: perfDuration(start), ok: true })
    return result
  } catch (error) {
    perfLog(label, { ...fields, durationMs: perfDuration(start), ok: false })
    throw error
  }
}

export function createPerfCounter(label: string, wait = 750) {
  const counts = new Map<string, { count: number; totalMs: number; maxMs: number }>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    if (!isPerfEnabled()) {
      counts.clear()
      return
    }
    if (counts.size === 0) return
    const operations = Object.fromEntries(
      [...counts.entries()].map(([key, value]) => [
        key,
        {
          count: value.count,
          totalMs: round(value.totalMs),
          maxMs: round(value.maxMs),
        },
      ]),
    )
    counts.clear()
    perfLog(label, { operations })
  }

  return {
    record(operation: string, durationMs: number) {
      if (!isPerfEnabled()) return
      const current = counts.get(operation) ?? { count: 0, totalMs: 0, maxMs: 0 }
      current.count += 1
      current.totalMs += durationMs
      current.maxMs = Math.max(current.maxMs, durationMs)
      counts.set(operation, current)
      if (!timer) timer = setTimeout(flush, wait)
    },
    flush,
  }
}
