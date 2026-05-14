import fs from "fs/promises"
import path from "path"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"

import { Global } from "../global"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export const Oauth = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .meta({ ref: "OAuth" })
export type Oauth = z.infer<typeof Oauth>

export const Api = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })
export type Api = z.infer<typeof Api>

export const WellKnown = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })
export type WellKnown = z.infer<typeof WellKnown>

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
export type Info = z.infer<typeof Info>

export class AuthServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "AuthServiceError"
  }
}

let testFile: string | undefined
export function __setTestFile(p: string) {
  testFile = p
}
const getFile = () => testFile ?? path.join(Global.Path.data, "auth.json")

const fail =
  (message: string) =>
  (cause: unknown): AuthServiceError =>
    cause instanceof AuthServiceError ? cause : new AuthServiceError(message, { cause })

export function normalizeProviderID(providerID: string) {
  return providerID.replace(/\/+$/, "")
}

async function readAuthFile(): Promise<Record<string, unknown>> {
  return Bun.file(getFile()).json().catch(() => ({}))
}

async function writeAuthFileRaw(data: unknown) {
  const file = getFile()
  await Bun.write(file, JSON.stringify(data, null, 2))
  await fs.chmod(file, 0o600)
}

async function writeAuthFile(data: Record<string, Info>) {
  await writeAuthFileRaw(data)
}

export namespace AuthService {
  export interface Service {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthServiceError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthServiceError>
    readonly set: (providerID: string, info: Info) => Effect.Effect<void, AuthServiceError>
    readonly remove: (providerID: string) => Effect.Effect<void, AuthServiceError>
  }
}

export class AuthService extends ServiceMap.Service<AuthService, AuthService.Service>()("@oco/Auth") {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const all = Effect.fn("AuthService.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await readAuthFile()
            const result: Record<string, Info> = {}
            for (const [key, value] of Object.entries(data)) {
              const parsed = Info.safeParse(value)
              if (!parsed.success) continue
              result[key] = parsed.data
            }
            return result
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const get = Effect.fn("AuthService.get")((providerID: string) =>
        all().pipe(
          Effect.map((auth) => {
            const normalized = normalizeProviderID(providerID)
            return auth[providerID] ?? auth[normalized] ?? auth[`${normalized}/`]
          }),
        ),
      )

      const set = Effect.fn("AuthService.set")((providerID: string, info: Info) =>
        all().pipe(
          Effect.flatMap((auth) =>
            Effect.tryPromise({
              try: async () => {
                const normalized = normalizeProviderID(providerID)
                if (normalized !== providerID) delete auth[providerID]
                delete auth[`${normalized}/`]
                await writeAuthFile({ ...auth, [normalized]: info })
              },
              catch: fail("Failed to write auth data"),
            }),
          ),
        ),
      )

      const remove = Effect.fn("AuthService.remove")((providerID: string) =>
        Effect.tryPromise({
          try: async () => {
            const data = await readAuthFile()
            const normalized = normalizeProviderID(providerID)
            delete data[providerID]
            delete data[normalized]
            delete data[`${normalized}/`]
            await writeAuthFileRaw(data)
          },
          catch: fail("Failed to write auth data"),
        }),
      )

      return AuthService.of({
        get,
        all,
        set,
        remove,
      })
    }),
  )

  static readonly defaultLayer = AuthService.layer
}
