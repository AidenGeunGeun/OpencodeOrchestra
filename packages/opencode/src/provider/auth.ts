import { Effect, ManagedRuntime } from "effect"
import z from "zod"

import { fn } from "@/util/fn"
import * as S from "./auth-service"

const runtime = ManagedRuntime.make(S.ProviderAuthService.defaultLayer)

function runPromise<A>(f: (service: S.ProviderAuthService.Service) => Effect.Effect<A, S.ProviderAuthError>) {
  return runtime.runPromise(S.ProviderAuthService.use(f))
}

export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  export async function methods() {
    return runPromise((service) => service.methods())
  }

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => runPromise((service) => service.authorize(input)),
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromise((service) => service.callback(input)),
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => runPromise((service) => service.api(input)),
  )

  export import OauthMissing = S.OauthMissing
  export import OauthCodeMissing = S.OauthCodeMissing
  export import OauthCallbackFailed = S.OauthCallbackFailed
}
