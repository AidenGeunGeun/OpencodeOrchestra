import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENCODE_MODELS_URL || "https://models.dev"
  }

  type DeepSeekProvider = {
    id?: string
    name?: string
    env?: string[]
    api?: string
    npm?: string
    models?: Record<string, Record<string, unknown>>
  }

  function withDeepSeekV4(input: Record<string, unknown>) {
    const provider = (input.deepseek ?? {}) as DeepSeekProvider
    const models = provider.models ?? {}
    const updated = "2026-04-24"
    const releaseDate = (modelID: string) => {
      const value = models[modelID]?.release_date
      return typeof value === "string" ? value : updated
    }
    const flash = {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      family: "deepseek-v4",
      attachment: false,
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      temperature: true,
      release_date: updated,
      last_updated: updated,
      modalities: { input: ["text"], output: ["text"] },
      open_weights: false,
      cost: { input: 0.14, output: 0.28, cache_read: 0.028 },
      limit: { context: 1_000_000, output: 384_000 },
    }
    const pro = {
      ...flash,
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      cost: { input: 1.74, output: 3.48, cache_read: 0.145 },
    }
    const chat: Record<string, unknown> = {
      ...(models["deepseek-chat"] ?? {}),
      id: "deepseek-chat",
      name: "DeepSeek Chat (Legacy Alias)",
      family: "deepseek-v4",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      release_date: releaseDate("deepseek-chat"),
      last_updated: updated,
      modalities: { input: ["text"], output: ["text"] },
      open_weights: false,
      cost: flash.cost,
      limit: flash.limit,
      status: "deprecated",
    }
    delete chat.interleaved
    const reasoner = {
      ...(models["deepseek-reasoner"] ?? {}),
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner (Legacy Alias)",
      family: "deepseek-v4",
      attachment: false,
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      temperature: true,
      release_date: releaseDate("deepseek-reasoner"),
      last_updated: updated,
      modalities: { input: ["text"], output: ["text"] },
      open_weights: false,
      cost: flash.cost,
      limit: flash.limit,
      status: "deprecated",
    }
    input.deepseek = {
      ...provider,
      id: "deepseek",
      name: provider.name ?? "DeepSeek",
      env: provider.env ?? ["DEEPSEEK_API_KEY"],
      api: provider.api ?? "https://api.deepseek.com",
      npm: provider.npm ?? "@ai-sdk/openai-compatible",
      models: Object.fromEntries([
        [flash.id, flash],
        [pro.id, pro],
        ["deepseek-chat", chat],
        ["deepseek-reasoner", reasoner],
        ...Object.entries(models).filter(
          ([id]) => !["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"].includes(id),
        ),
      ]),
    }
    return input
  }

  export const Data = lazy(async () => {
    const file = Bun.file(Flag.OPENCODE_MODELS_PATH ?? filepath)
    const result = await file.json().catch(() => {})
    if (result) return withDeepSeekV4(result)
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return withDeepSeekV4(snapshot)
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
    const json = await fetch(`${url()}/api.json`).then((x) => x.text())
    return withDeepSeekV4(JSON.parse(json))
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh() {
    const file = Bun.file(filepath)
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Bun.write(file, await result.text())
      ModelsDev.Data.reset()
    }
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
