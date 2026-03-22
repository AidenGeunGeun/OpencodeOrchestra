import { Effect, Layer, Option, ServiceMap } from "effect"
import z from "zod"

import { Log } from "@/util/log"
import { AccountRepo, type AccountRow } from "./repo"
import {
  AccessToken,
  Account,
  type AccountError,
  AccountID,
  AccountServiceError,
  DeviceCode,
  Login,
  Org,
  OrgID,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
  RefreshToken,
  UserCode,
} from "./schema"

export * from "./schema"

const log = Log.create({ service: "account" })

export type AccountOrgs = {
  account: Account
  orgs: readonly Org[]
}

const clientId = "opencode-cli"

const mapAccountServiceError =
  (message = "Account service operation failed") =>
  (cause: unknown) =>
    cause instanceof AccountServiceError ? cause : new AccountServiceError(message, { cause })

function authHeaders(accessToken?: AccessToken, extra: Record<string, string> = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...extra,
  }
}

function parseJson<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new AccountServiceError(message, { cause: parsed.error })
}

const RemoteConfig = z.object({
  config: z.record(z.string(), z.unknown()),
})

const TokenRefresh = z.object({
  access_token: AccessToken,
  refresh_token: RefreshToken,
  expires_in: z.number(),
})

const DeviceAuth = z.object({
  device_code: DeviceCode,
  user_code: UserCode,
  verification_uri_complete: z.string(),
  expires_in: z.number(),
  interval: z.number(),
})

const DeviceTokenSuccess = z.object({
  access_token: AccessToken,
  refresh_token: RefreshToken,
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
})

const DeviceTokenError = z.object({
  error: z.string(),
  error_description: z.string().optional(),
})

const User = z.object({
  id: AccountID,
  email: z.string(),
})

function toPollResult(error: string): PollResult {
  if (error === "authorization_pending") return new PollPending()
  if (error === "slow_down") return new PollSlow()
  if (error === "expired_token") return new PollExpired()
  if (error === "access_denied") return new PollDenied()
  return new PollError(error)
}

export namespace AccountService {
  export interface Service {
    readonly active: () => Effect.Effect<Option.Option<Account>, AccountError>
    readonly list: () => Effect.Effect<Account[], AccountError>
    readonly orgsByAccount: () => Effect.Effect<readonly AccountOrgs[], AccountError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountError>
    readonly orgs: (accountID: AccountID) => Effect.Effect<readonly Org[], AccountError>
    readonly config: (accountID: AccountID, orgID: OrgID) => Effect.Effect<Option.Option<Record<string, unknown>>, AccountError>
    readonly token: (accountID: AccountID) => Effect.Effect<Option.Option<AccessToken>, AccountError>
    readonly login: (url: string) => Effect.Effect<Login, AccountError>
    readonly poll: (input: Login) => Effect.Effect<PollResult, AccountError>
  }
}

export class AccountService extends ServiceMap.Service<AccountService, AccountService.Service>()("@oco/Account") {
  static readonly layer = Layer.effect(
    AccountService,
    Effect.gen(function* () {
      const repo = yield* AccountRepo

      const request = <T>(input: {
        url: string
        init?: RequestInit
        schema: z.ZodType<T>
        message: string
      }) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(input.url, input.init)
            const json = await response.json().catch(() => undefined)
            if (!response.ok) {
              throw new AccountServiceError(input.message, {
                cause: json ?? `${response.status} ${response.statusText}`,
              })
            }
            return parseJson(input.schema, json, input.message)
          },
          catch: mapAccountServiceError(input.message),
        })

      const requestOptional = (input: {
        url: string
        init?: RequestInit
      }) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(input.url, input.init)
            if (response.status === 404) return Option.none<Record<string, unknown>>()
            const json = await response.json().catch(() => undefined)
            if (!response.ok) {
              throw new AccountServiceError("Failed to fetch remote config", {
                cause: json ?? `${response.status} ${response.statusText}`,
              })
            }
            const parsed = parseJson(RemoteConfig, json, "Failed to decode remote config")
            return Option.some(parsed.config)
          },
          catch: mapAccountServiceError("Failed to fetch remote config"),
        })

      const resolveToken = Effect.fnUntraced(function* (row: AccountRow) {
        const now = Date.now()
        if (row.token_expiry && row.token_expiry > now) return row.access_token

        const parsed = yield* request({
          url: `${row.url}/auth/device/token`,
          init: {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              grant_type: "refresh_token",
              refresh_token: row.refresh_token,
              client_id: clientId,
            }),
          },
          schema: TokenRefresh,
          message: "Failed to refresh console token",
        })

        const expiry = Option.some(now + parsed.expires_in * 1000)
        yield* repo.persistToken({
          accountID: row.id,
          accessToken: parsed.access_token,
          refreshToken: parsed.refresh_token,
          expiry,
        })

        return parsed.access_token
      })

      const resolveAccess = Effect.fnUntraced(function* (accountID: AccountID) {
        const maybeAccount = yield* repo.getRow(accountID)
        if (Option.isNone(maybeAccount)) return Option.none<{ account: AccountRow; accessToken: AccessToken }>()

        const account = maybeAccount.value
        const accessToken = yield* resolveToken(account)
        return Option.some({ account, accessToken })
      })

      const fetchOrgs = Effect.fnUntraced(function* (url: string, accessToken: AccessToken) {
        return yield* request({
          url: `${url}/api/orgs`,
          init: {
            headers: authHeaders(accessToken),
          },
          schema: z.array(Org),
          message: "Failed to fetch console orgs",
        })
      })

      const fetchUser = Effect.fnUntraced(function* (url: string, accessToken: AccessToken) {
        return yield* request({
          url: `${url}/api/user`,
          init: {
            headers: authHeaders(accessToken),
          },
          schema: User,
          message: "Failed to fetch console user",
        })
      })

      const token = Effect.fn("AccountService.token")((accountID: AccountID) =>
        resolveAccess(accountID).pipe(Effect.map(Option.map((result) => result.accessToken))),
      )

      const orgs = Effect.fn("AccountService.orgs")(function* (accountID: AccountID) {
        const resolved = yield* resolveAccess(accountID)
        if (Option.isNone(resolved)) return []
        return yield* fetchOrgs(resolved.value.account.url, resolved.value.accessToken)
      })

      const orgsByAccount = Effect.fn("AccountService.orgsByAccount")(function* () {
        const accounts = yield* repo.list()
        const groups: AccountOrgs[] = []

        for (const account of accounts) {
          const result = yield* Effect.match(orgs(account.id), {
            onFailure: (error) => {
              log.warn("failed to fetch orgs for account", {
                accountID: account.id,
                error: error.message,
              })
              return Option.none<readonly Org[]>()
            },
            onSuccess: (remoteOrgs) => Option.some(remoteOrgs),
          })
          if (Option.isSome(result)) groups.push({ account, orgs: result.value })
        }

        return groups
      })

      const config = Effect.fn("AccountService.config")(function* (accountID: AccountID, orgID: OrgID) {
        const resolved = yield* resolveAccess(accountID)
        if (Option.isNone(resolved)) return Option.none<Record<string, unknown>>()

        const { account, accessToken } = resolved.value
        return yield* requestOptional({
          url: `${account.url}/api/config`,
          init: {
            headers: authHeaders(accessToken, { "x-org-id": orgID }),
          },
        })
      })

      const login = Effect.fn("AccountService.login")(function* (server: string) {
        const parsed = yield* request({
          url: `${server}/auth/device/code`,
          init: {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ client_id: clientId }),
          },
          schema: DeviceAuth,
          message: "Failed to start device login",
        })

        return Login.parse({
          code: parsed.device_code,
          user: parsed.user_code,
          url: parsed.verification_uri_complete.startsWith("http")
            ? parsed.verification_uri_complete
            : `${server}${parsed.verification_uri_complete}`,
          server,
          expiry: parsed.expires_in * 1000,
          interval: parsed.interval * 1000,
        })
      })

      const poll = Effect.fn("AccountService.poll")(function* (input: Login) {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${input.server}/auth/device/token`, {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                device_code: input.code,
                client_id: clientId,
              }),
            }),
          catch: mapAccountServiceError("Failed to poll device login"),
        })

        const json = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: mapAccountServiceError("Failed to decode device login response"),
        })

        const parsedError = DeviceTokenError.safeParse(json)
        if (parsedError.success) return toPollResult(parsedError.data.error)

        if (!response.ok) {
          return yield* Effect.fail(new AccountServiceError("Failed to poll device login", { cause: json }))
        }

        const parsed = parseJson(DeviceTokenSuccess, json, "Failed to decode device token")
        const accessToken = parsed.access_token
        const [account, remoteOrgs] = yield* Effect.all([
          fetchUser(input.server, accessToken),
          fetchOrgs(input.server, accessToken),
        ])

        const firstOrgID = remoteOrgs[0]?.id
        const expiry = Date.now() + parsed.expires_in * 1000

        yield* repo.persistAccount({
          id: account.id,
          email: account.email,
          url: input.server,
          accessToken,
          refreshToken: parsed.refresh_token,
          expiry,
          orgID: firstOrgID ? Option.some(firstOrgID) : Option.none<OrgID>(),
        })

        return new PollSuccess(account.email)
      })

      return AccountService.of({
        active: repo.active,
        list: repo.list,
        orgsByAccount,
        remove: repo.remove,
        use: repo.use,
        orgs,
        config,
        token,
        login,
        poll,
      })
    }),
  )

  static readonly defaultLayer = AccountService.layer.pipe(Layer.provide(AccountRepo.layer))
}
