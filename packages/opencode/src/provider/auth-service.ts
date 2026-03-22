import type { AuthOuathResult } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { Effect, Layer, ServiceMap } from "effect"
import { filter, fromEntries, map, pipe } from "remeda"
import z from "zod"

import { Instance } from "@/project/instance"
import * as Auth from "@/auth/service"
import { Plugin } from "../plugin"

export const Method = z
  .object({
    type: z.union([z.literal("oauth"), z.literal("api")]),
    label: z.string(),
  })
  .meta({
    ref: "ProviderAuthMethod",
  })
export type Method = z.infer<typeof Method>

export const Authorization = z
  .object({
    url: z.string(),
    method: z.union([z.literal("auto"), z.literal("code")]),
    instructions: z.string(),
  })
  .meta({
    ref: "ProviderAuthAuthorization",
  })
export type Authorization = z.infer<typeof Authorization>

export const OauthMissing = NamedError.create(
  "ProviderAuthOauthMissing",
  z.object({
    providerID: z.string(),
  }),
)

export const OauthCodeMissing = NamedError.create(
  "ProviderAuthOauthCodeMissing",
  z.object({
    providerID: z.string(),
  }),
)

export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

export type ProviderAuthError =
  | Auth.AuthServiceError
  | InstanceType<typeof OauthMissing>
  | InstanceType<typeof OauthCodeMissing>
  | InstanceType<typeof OauthCallbackFailed>

export namespace ProviderAuthService {
  export interface Service {
    readonly methods: () => Effect.Effect<Record<string, Method[]>>
    readonly authorize: (input: { providerID: string; method: number }) => Effect.Effect<Authorization | undefined>
    readonly callback: (input: {
      providerID: string
      method: number
      code?: string
    }) => Effect.Effect<void, ProviderAuthError>
    readonly api: (input: { providerID: string; key: string }) => Effect.Effect<void, Auth.AuthServiceError>
  }
}

export class ProviderAuthService extends ServiceMap.Service<ProviderAuthService, ProviderAuthService.Service>()(
  "@oco/ProviderAuth",
) {
  static readonly layer = Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* Auth.AuthService
      const state = Instance.state(async () => {
        const methods = pipe(
          await Plugin.list(),
          filter((plugin) => plugin.auth?.provider !== undefined),
          map((plugin) => [plugin.auth!.provider, plugin.auth!] as const),
          fromEntries(),
        )
        return { methods, pending: new Map<string, AuthOuathResult>() }
      })

      const methods = Effect.fn("ProviderAuthService.methods")(() =>
        Effect.promise(async () => {
          const current = await state()
          return Object.fromEntries(
            Object.entries(current.methods).map(([providerID, config]) => [
              providerID,
              config.methods.map((method): Method => ({ type: method.type, label: method.label })),
            ]),
          )
        }),
      )

      const authorize = Effect.fn("ProviderAuthService.authorize")((input: { providerID: string; method: number }) =>
        Effect.promise(async () => {
          const current = await state()
          const provider = current.methods[input.providerID]
          const method = provider?.methods[input.method]
          if (!method || method.type !== "oauth") return
          const result = await method.authorize()
          current.pending.set(input.providerID, result)
          return {
            url: result.url,
            method: result.method,
            instructions: result.instructions,
          }
        }),
      )

      const callback = Effect.fn("ProviderAuthService.callback")((input: {
        providerID: string
        method: number
        code?: string
      }) =>
        Effect.gen(function* () {
          const current = yield* Effect.promise(() => state())
          const match = current.pending.get(input.providerID)
          if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))
          if (match.method === "code" && !input.code)
            return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))

          const result = yield* Effect.promise(() =>
            match.method === "code" ? match.callback(input.code!) : match.callback(),
          )

          if (!result || result.type !== "success") {
            return yield* Effect.fail(new OauthCallbackFailed({}))
          }

          if ("key" in result) {
            yield* auth.set(input.providerID, {
              type: "api",
              key: result.key,
            })
          }

          if ("refresh" in result) {
            const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
            const info = Auth.Oauth.parse({
              type: "oauth",
              refresh,
              access,
              expires,
              ...extraFields,
            })
            yield* auth.set(input.providerID, info)
          }
        }),
      )

      const api = Effect.fn("ProviderAuthService.api")((input: { providerID: string; key: string }) =>
        auth.set(input.providerID, {
          type: "api",
          key: input.key,
        }),
      )

      return ProviderAuthService.of({
        methods,
        authorize,
        callback,
        api,
      })
    }),
  )

  static readonly defaultLayer = ProviderAuthService.layer.pipe(Layer.provide(Auth.AuthService.defaultLayer))
}
