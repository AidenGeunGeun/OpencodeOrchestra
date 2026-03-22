import * as prompts from "@clack/prompts"
import { Effect, Option } from "effect"
import open from "open"

import { AccountService, type AccountOrgs, PollDenied, PollError, PollExpired, PollPending, PollSlow, PollSuccess } from "@/account/service"
import { runtime } from "@/effect/runtime"
import { cmd } from "./cmd"
import { UI } from "../ui"

const DEFAULT_CONSOLE_URL = "https://opencode.ai"

function normalizeConsoleURL(url?: string) {
  const input = (url || DEFAULT_CONSOLE_URL).trim()
  const withProtocol = input.startsWith("http://") || input.startsWith("https://") ? input : `https://${input}`
  return withProtocol.replace(/\/+$/, "")
}

const openBrowser = (url: string) => Effect.promise(() => open(url).catch(() => undefined))

async function chooseAccount(groups: readonly AccountOrgs[], activeID?: string) {
  const selected = await prompts.select({
    message: "Select account",
    options: groups.map((group) => ({
      value: group.account.id,
      label: group.account.email,
      hint: `${group.account.url}${group.account.id === activeID ? " (active)" : ""}`,
    })),
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return groups.find((group) => group.account.id === selected)
}

async function chooseOrg(groups: readonly AccountOrgs[], activeOrgID?: string) {
  const selected = await prompts.select({
    message: "Select org",
    options: groups.flatMap((group) =>
      group.orgs.map((org) => ({
        value: `${group.account.id}:${org.id}`,
        label: org.name,
        hint: `${group.account.email}${org.id === activeOrgID ? " (active)" : ""}`,
      })),
    ),
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  const [accountID, orgID] = selected.split(":")
  return groups
    .flatMap((group) => group.orgs.map((org) => ({ accountID: group.account.id, orgID: org.id, label: org.name })))
    .find((org) => org.accountID === accountID && org.orgID === orgID)
}

const loginEffect = Effect.fn("Console.login")(function* (url?: string) {
  const service = yield* AccountService
  const server = normalizeConsoleURL(url)

  prompts.intro("Log in to OpenCode Console")
  const login = yield* service.login(server)

  prompts.log.info("Go to: " + login.url)
  prompts.log.info("Enter code: " + login.user)
  yield* openBrowser(login.url)

  const spinner = prompts.spinner()
  spinner.start("Waiting for authorization...")

  let wait = login.interval
  const expiresAt = Date.now() + login.expiry

  while (Date.now() < expiresAt) {
    yield* Effect.promise(() => Bun.sleep(wait))
    const result = yield* service.poll(login)

    if (result instanceof PollPending) continue
    if (result instanceof PollSlow) {
      wait += 5000
      continue
    }
    if (result instanceof PollSuccess) {
      spinner.stop("Logged in as " + result.email)
      prompts.outro("Done")
      return
    }
    if (result instanceof PollExpired) {
      spinner.stop("Device code expired", 1)
      return
    }
    if (result instanceof PollDenied) {
      spinner.stop("Authorization denied", 1)
      return
    }
    if (result instanceof PollError) {
      spinner.stop("Error: " + String(result.cause), 1)
      return
    }
  }

  spinner.stop("Device code expired", 1)
})

const logoutEffect = Effect.fn("Console.logout")(function* (email?: string) {
  const service = yield* AccountService
  const accounts = yield* service.list()
  if (accounts.length === 0) {
    prompts.log.info("Not logged in")
    return
  }

  if (email) {
    const match = accounts.find((account) => account.email === email)
    if (!match) {
      prompts.log.error("Account not found: " + email)
      return
    }
    yield* service.remove(match.id)
    prompts.outro("Logged out from " + email)
    return
  }

  const active = yield* service.active()
  const activeID = Option.getOrUndefined(Option.map(active, (account) => account.id))
  const selected = yield* Effect.promise(async () => {
    const value = await prompts.select({
      message: "Select account to log out",
      options: accounts.map((account) => ({
        value: account.id,
        label: account.email,
        hint: `${account.url}${account.id === activeID ? " (active)" : ""}`,
      })),
    })
    if (prompts.isCancel(value)) throw new UI.CancelledError()
    return accounts.find((account) => account.id === value)
  })

  if (!selected) return
  yield* service.remove(selected.id)
  prompts.outro("Logged out from " + selected.email)
})

const switchEffect = Effect.fn("Console.switch")(function* () {
  const service = yield* AccountService
  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) {
    prompts.log.info("No console accounts found")
    return
  }

  const active = yield* service.active()
  const activeID = Option.getOrUndefined(Option.map(active, (account) => account.id))
  const selected = yield* Effect.promise(() => chooseAccount(groups, activeID))
  if (!selected) return

  const currentOrgID = activeID === selected.account.id ? selected.account.active_org_id : null
  const nextOrgID = currentOrgID ?? selected.orgs[0]?.id ?? null

  yield* service.use(selected.account.id, nextOrgID ? Option.some(nextOrgID) : Option.none())
  prompts.outro(`Switched to ${selected.account.email}`)
})

const orgsEffect = Effect.fn("Console.orgs")(function* () {
  const service = yield* AccountService
  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) {
    prompts.log.info("No console accounts found")
    return
  }

  const active = yield* service.active()
  const activeOrgID = Option.getOrUndefined(
    Option.flatMap(active, (account) => (account.active_org_id ? Option.some(account.active_org_id) : Option.none())),
  )
  const options = groups.flatMap((group) => group.orgs)
  if (options.length === 0) {
    prompts.log.info("No orgs found")
    return
  }

  prompts.intro("Console orgs")
  for (const group of groups) {
    for (const org of group.orgs) {
      const marker = org.id === activeOrgID ? "*" : "-"
      prompts.log.info(`${marker} ${org.name} (${group.account.email})`)
    }
  }

  const selected = yield* Effect.promise(() => chooseOrg(groups, activeOrgID))
  if (!selected) return

  yield* service.use(selected.accountID, Option.some(selected.orgID))
  prompts.outro(`Switched to ${selected.label}`)
})

export const LoginCommand = cmd({
  command: "login [url]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "console URL",
      type: "string",
      default: DEFAULT_CONSOLE_URL,
    }),
  async handler(args) {
    UI.empty()
    await runtime.runPromise(loginEffect(args.url))
  },
})

export const LogoutCommand = cmd({
  command: "logout [email]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    await runtime.runPromise(logoutEffect(args.email))
  },
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: false,
  async handler() {
    UI.empty()
    await runtime.runPromise(switchEffect())
  },
})

export const OrgsCommand = cmd({
  command: "orgs",
  describe: false,
  async handler() {
    UI.empty()
    await runtime.runPromise(orgsEffect())
  },
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: "manage OpenCode Console account",
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "log in to console",
      })
      .command({
        ...LogoutCommand,
        describe: "log out from console",
      })
      .command({
        ...SwitchCommand,
        describe: "switch active console account",
      })
      .command({
        ...OrgsCommand,
        describe: "list and switch orgs",
      })
      .demandCommand(),
  async handler() {},
})
