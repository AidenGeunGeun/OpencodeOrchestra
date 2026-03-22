import z from "zod"

export const AccountID = z.string()
export type AccountID = z.infer<typeof AccountID>

export const OrgID = z.string()
export type OrgID = z.infer<typeof OrgID>

export const AccessToken = z.string()
export type AccessToken = z.infer<typeof AccessToken>

export const RefreshToken = z.string()
export type RefreshToken = z.infer<typeof RefreshToken>

export const DeviceCode = z.string()
export type DeviceCode = z.infer<typeof DeviceCode>

export const UserCode = z.string()
export type UserCode = z.infer<typeof UserCode>

export const Account = z.object({
  id: AccountID,
  email: z.string(),
  url: z.string(),
  active_org_id: OrgID.nullable(),
})
export type Account = z.infer<typeof Account>

export const AccountState = z.object({
  active_account_id: AccountID.nullable(),
  active_org_id: OrgID.nullable(),
})
export type AccountState = z.infer<typeof AccountState>

export const Org = z.object({
  id: OrgID,
  name: z.string(),
})
export type Org = z.infer<typeof Org>

export class AccountRepoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "AccountRepoError"
  }
}

export class AccountServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "AccountServiceError"
  }
}

export type AccountError = AccountRepoError | AccountServiceError

export const Login = z.object({
  code: DeviceCode,
  user: UserCode,
  url: z.string(),
  server: z.string(),
  expiry: z.number(),
  interval: z.number(),
})
export type Login = z.infer<typeof Login>

export class PollSuccess {
  readonly _tag = "PollSuccess"

  constructor(readonly email: string) {}
}

export class PollPending {
  readonly _tag = "PollPending"
}

export class PollSlow {
  readonly _tag = "PollSlow"
}

export class PollExpired {
  readonly _tag = "PollExpired"
}

export class PollDenied {
  readonly _tag = "PollDenied"
}

export class PollError {
  readonly _tag = "PollError"

  constructor(readonly cause: unknown) {}
}

export type PollResult = PollSuccess | PollPending | PollSlow | PollExpired | PollDenied | PollError
