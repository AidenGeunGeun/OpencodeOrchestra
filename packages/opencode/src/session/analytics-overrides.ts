// OCO-only file: local pricing override layer for the Analytics page. See oco-dev skill deltas-catalog.md.
import path from "node:path"
import fs from "node:fs/promises"
import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"

/**
 * Pricing override layer for OCO Analytics.
 *
 * Lives at `~/.config/oco/analytics-pricing.json` and is consulted before the upstream
 * models.dev catalog when computing API-equivalent value. It supports two entry shapes:
 *
 *   1. `aliases`: "treat provider/model X as having the standard pricing of provider/model Y"
 *   2. `rates`: "use these explicit input/output/cacheRead/cacheWrite rates for provider/model X"
 *
 * The file is local-only, never sent off-device, and editable by the user or the agent
 * directly. A refresh of the Analytics page picks up edits without a rebuild.
 */
export namespace AnalyticsOverrides {
  const log = Log.create({ service: "analytics.overrides" })

  export const ProviderModel = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  })
  export type ProviderModel = z.infer<typeof ProviderModel>

  export const Alias = z.object({
    match: ProviderModel,
    as: ProviderModel,
    note: z.string().optional(),
  })
  export type Alias = z.infer<typeof Alias>

  export const RateEntry = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
    note: z.string().optional(),
  })
  export type RateEntry = z.infer<typeof RateEntry>

  export const File = z
    .object({
      aliases: Alias.array().optional(),
      rates: RateEntry.array().optional(),
    })
    .strict()
  export type File = z.infer<typeof File>

  export type Resolved = {
    aliases: Map<string, ProviderModel>
    rates: Map<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>
  }

  export function path_() {
    return path.join(Global.Path.config, "analytics-pricing.json")
  }

  function key(input: ProviderModel) {
    return `${input.provider}/${input.model}`
  }

  /**
   * Build a Resolved table from a parsed File. Last-wins per key for both aliases and rates.
   * Direct rates take precedence over aliases at lookup time (see resolveRates).
   */
  export function resolve(file: File | undefined): Resolved {
    const aliases = new Map<string, ProviderModel>()
    const rates = new Map<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>()
    if (!file) return { aliases, rates }
    for (const alias of file.aliases ?? []) aliases.set(key(alias.match), alias.as)
    for (const rate of file.rates ?? [])
      rates.set(key({ provider: rate.provider, model: rate.model }), {
        input: rate.input,
        output: rate.output,
        ...(rate.cacheRead !== undefined ? { cacheRead: rate.cacheRead } : {}),
        ...(rate.cacheWrite !== undefined ? { cacheWrite: rate.cacheWrite } : {}),
      })
    return { aliases, rates }
  }

  /**
   * Look up pricing for (provider, model). Returns:
   *   - direct rates if a `rates` entry exists for that pair, OR
   *   - an `aliasTo` { provider, model } pointing the caller at a different catalog entry, OR
   *   - undefined when this layer has nothing to say (caller falls back to models.dev).
   */
  export function lookup(
    resolved: Resolved,
    provider: string,
    model: string,
  ):
    | { kind: "rates"; rates: { input: number; output: number; cacheRead?: number; cacheWrite?: number } }
    | { kind: "alias"; target: ProviderModel }
    | undefined {
    const k = key({ provider, model })
    const direct = resolved.rates.get(k)
    if (direct) return { kind: "rates", rates: direct }
    const alias = resolved.aliases.get(k)
    if (alias) return { kind: "alias", target: alias }
    return undefined
  }

  export async function load(): Promise<File | undefined> {
    const filepath = path_()
    try {
      const raw = await fs.readFile(filepath, "utf8")
      const parsed = JSON.parse(raw)
      const result = File.safeParse(parsed)
      if (!result.success) {
        log.warn("invalid analytics-pricing.json", { issues: result.error.issues.map((i) => i.message).slice(0, 5) })
        return undefined
      }
      return result.data
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === "ENOENT") return undefined
      log.warn("could not load analytics-pricing.json", { error: (err as Error).message })
      return undefined
    }
  }

  export async function loadResolved(): Promise<Resolved> {
    return resolve(await load())
  }
}
