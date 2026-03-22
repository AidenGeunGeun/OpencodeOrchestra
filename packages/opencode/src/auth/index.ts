import { Effect } from "effect"

import { runtime } from "@/effect/runtime"
import * as S from "./service"

export { OAUTH_DUMMY_KEY } from "./service"

function runPromise<A>(f: (service: S.AuthService.Service) => Effect.Effect<A, S.AuthServiceError>) {
  return runtime.runPromise(S.AuthService.use(f))
}

export namespace Auth {
  export const Oauth = S.Oauth
  export type Oauth = import("./service").Oauth

  export const Api = S.Api
  export type Api = import("./service").Api

  export const WellKnown = S.WellKnown
  export type WellKnown = import("./service").WellKnown

  export const Info = S.Info
  export type Info = import("./service").Info

  export async function get(providerID: string) {
    return runPromise((service) => service.get(S.normalizeProviderID(providerID)))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(providerID: string, info: Info) {
    return runPromise((service) => service.set(S.normalizeProviderID(providerID), info))
  }

  export async function remove(providerID: string) {
    return runPromise((service) => service.remove(S.normalizeProviderID(providerID)))
  }
}
