import { SecretVault } from "./vault"
import { SecretScope } from "./scope"

export namespace SecretRedaction {
  const MIN_VALUE_LENGTH = 8

  export type Pattern = {
    name: string
    marker: string
    values: string[]
  }

  export async function patterns(projectID: string) {
    const entries = await SecretVault.sensitiveEntries(projectID)
    return entries.map((entry): Pattern => {
      const variants = new Set<string>([entry.value])
      const urlEncoded = encodeURIComponent(entry.value)
      variants.add(urlEncoded)
      variants.add(urlEncoded.toLowerCase())
      variants.add(JSON.stringify(entry.value).slice(1, -1))
      return {
        name: entry.name,
        marker: `[REDACTED:${entry.name}]`,
        values: [...variants].filter((value) => value.length >= MIN_VALUE_LENGTH),
      }
    })
  }

  export function apply(value: string, patterns: Pattern[]) {
    let result = value
    const replacements = patterns
      .flatMap((pattern) => pattern.values.map((variant) => ({ variant, marker: pattern.marker })))
      .sort((a, b) => b.variant.length - a.variant.length)
    for (const replacement of replacements) {
      result = result.split(replacement.variant).join(replacement.marker)
    }
    return result
  }

  export function applyStreaming(value: string, patterns: Pattern[]) {
    let result = apply(value, patterns)
    for (const pattern of patterns) {
      for (const variant of pattern.values) {
        const max = Math.min(variant.length - 1, result.length)
        for (let length = max; length > 0; length--) {
          if (!result.endsWith(variant.slice(0, length))) continue
          result = result.slice(0, -length) + pattern.marker
          break
        }
      }
    }
    return result
  }

  export function applyUnknown<T>(value: T, patterns: Pattern[]): T {
    if (typeof value === "string") return apply(value, patterns) as T
    if (!value || typeof value !== "object") return value
    if (Array.isArray(value)) return value.map((item) => applyUnknown(item, patterns)) as T
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[apply(key, patterns)] = applyUnknown(item, patterns)
    }
    return output as T
  }

  export async function forProject<T>(projectID: string, value: T) {
    return applyUnknown(value, await patterns(projectID))
  }

  export async function forCurrentProject<T>(value: T) {
    try {
      return forProject(SecretScope.currentID(), value)
    } catch {
      return value
    }
  }

  export async function patternsForCurrentProject() {
    return patterns(SecretScope.currentID())
  }

  export async function forSession<T>(sessionID: string, value: T) {
    const scope = SecretScope.forSession(sessionID)
    if (scope) return forProject(scope.id, value)
    return forCurrentProject(value)
  }
}
