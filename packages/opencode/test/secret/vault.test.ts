import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database, eq } from "../../src/storage/db"
import { Project } from "../../src/project/project"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SecretVault } from "../../src/secret/vault"
import { SecretRedaction } from "../../src/secret/redaction"
import { SecretScope } from "../../src/secret/scope"
import { SecretEntryTable } from "../../src/secret/vault.sql"
import { Global } from "../../src/global"
import { Identifier } from "../../src/id/id"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ReadTool } from "../../src/tool/read"
import { GrepTool } from "../../src/tool/grep"
import { GlobTool } from "../../src/tool/glob"
import { BashTool } from "../../src/tool/bash"
import { Log } from "../../src/util/log"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

Log.init({ print: false })

describe("SecretVault", () => {
  test("initializes fresh Secure Env vault keys locally without system security services", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyFile = path.join(tmp.path, "fresh-secret-vault.key")
    const { project } = await Project.fromDirectory(tmp.path)

    SecretVault.__testing.setKeyPathForTesting(keyFile)
    SecretVault.__testing.setExistingMaterialForTesting(false)
    SecretVault.__testing.resetStats()

    try {
      const profile = await SecretVault.createProfile({ projectID: project.id, name: "fresh" })
      await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "FRESH_LOCAL_ONLY",
        risk: "medium",
        value: "fresh-local-secret-value",
      })

      expect(await SecretVault.__testing.keyDiagnostics()).toEqual({
        localKeyExists: true,
        keySource: "local-generated",
      })
    } finally {
      SecretVault.__testing.setExistingMaterialForTesting(undefined)
      SecretVault.__testing.setKeyPathForTesting(undefined)
      SecretVault.__testing.resetStats()
    }
  })

  test("fails closed for existing encrypted material when the local key is missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyFile = path.join(tmp.path, "missing-local-secret-vault.key")
    const { project } = await Project.fromDirectory(tmp.path)
    const secretValue = "missing-local-secret-value"

    SecretVault.__testing.setKeyPathForTesting(keyFile)
    SecretVault.__testing.setExistingMaterialForTesting(false)

    try {
      const profile = await SecretVault.createProfile({ projectID: project.id, name: "legacy" })
      const entry = await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "MISSING_LOCAL_SECRET",
        risk: "high",
        value: secretValue,
      })
      await fs.rm(keyFile, { force: true })
      SecretVault.__testing.resetRuntimeCaches()
      SecretVault.__testing.resetStats()
      SecretVault.__testing.setExistingMaterialForTesting(true)

      await expect(SecretVault.revealValue({ projectID: project.id, profileID: profile.id, entryID: entry.id })).rejects.toThrow(
        "SecretVaultKeyUnavailableError",
      )
      expect(await SecretVault.__testing.keyDiagnostics()).toEqual({
        localKeyExists: false,
        keySource: "missing-existing-material",
      })
    } finally {
      SecretVault.__testing.setExistingMaterialForTesting(undefined)
      SecretVault.__testing.setKeyPathForTesting(undefined)
      SecretVault.__testing.resetStats()
    }
  })

  test("skips vault key loading when a scope has no enabled entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyFile = path.join(tmp.path, "disabled-secret-vault.key")
    const { project } = await Project.fromDirectory(tmp.path)

    SecretVault.__testing.setKeyPathForTesting(keyFile)
    SecretVault.__testing.setExistingMaterialForTesting(false)

    try {
      const profile = await SecretVault.createProfile({ projectID: project.id, name: "disabled" })
      const entry = await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "DISABLED_ONLY_SECRET",
        risk: "medium",
        value: "disabled-secret-value",
      })
      await SecretVault.updateEntry({ projectID: project.id, profileID: profile.id, entryID: entry.id, enabled: false })
      await fs.rm(keyFile, { force: true })
      SecretVault.__testing.resetRuntimeCaches()
      SecretVault.__testing.resetStats()
      SecretRedaction.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetStats()
      SecretVault.__testing.setExistingMaterialForTesting(true)

      await expect(SecretRedaction.forProject(project.id, "value=disabled-secret-value")).resolves.toBe("value=disabled-secret-value")
      expect(SecretVault.__testing.stats()).toEqual({ keyLoads: 0, sensitiveLoads: 1 })
      expect(await SecretVault.__testing.keyDiagnostics()).toEqual({
        localKeyExists: false,
        keySource: undefined,
      })
    } finally {
      SecretVault.__testing.setExistingMaterialForTesting(undefined)
      SecretVault.__testing.setKeyPathForTesting(undefined)
      SecretVault.__testing.resetStats()
      SecretRedaction.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetStats()
    }
  })

  test("contains no production Keychain or macOS security command path", async () => {
    const productionSources = [
      "../../src/secret/vault.ts",
      "../../src/secret/redaction.ts",
      "../../src/tool/bash.ts",
      "../../src/tool/tool.ts",
      "../../src/tool/registry.ts",
      "../../src/session/index.ts",
      "../../src/session/message-v2.ts",
      "../../src/session/prompt.ts",
      "../../src/mcp/index.ts",
      "../../src/plugin/index.ts",
      "../../src/server/routes/secret.ts",
    ]
    const forbidden = ["find-generic-password", "add-generic-password", "Keychain", "keychain", "$`security"]

    for (const sourcePath of productionSources) {
      const source = await fs.readFile(new URL(sourcePath, import.meta.url), "utf8")
      for (const term of forbidden) expect(source).not.toContain(term)
    }
  })

  test("keeps Secure Env injection out of plugin and MCP process environments", async () => {
    const pluginSource = await fs.readFile(new URL("../../src/plugin/index.ts", import.meta.url), "utf8")
    const mcpSource = await fs.readFile(new URL("../../src/mcp/index.ts", import.meta.url), "utf8")

    expect(pluginSource).not.toContain("SecretVault.sensitiveEntries")
    expect(pluginSource).not.toContain("SecretVault.sensitiveValues")
    expect(pluginSource).not.toContain("secureEnv")
    expect(mcpSource).not.toContain("SecretVault.sensitiveEntries")
    expect(mcpSource).not.toContain("SecretVault.sensitiveValues")
    expect(mcpSource).not.toContain("secureEnv")
  })

  test("fails closed instead of returning unredacted output when vault key is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyFile = path.join(tmp.path, "fail-closed-secret-vault.key")
    const { project } = await Project.fromDirectory(tmp.path)

    SecretVault.__testing.setKeyPathForTesting(keyFile)
    SecretVault.__testing.setExistingMaterialForTesting(false)

    try {
      const profile = await SecretVault.createProfile({ projectID: project.id, name: "fail-closed" })
      await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "FAIL_CLOSED_SECRET",
        risk: "high",
        value: "fail-closed-secret-value",
      })
      await fs.rm(keyFile, { force: true })
      SecretVault.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetRuntimeCaches()
      SecretVault.__testing.setExistingMaterialForTesting(true)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(SecretRedaction.forCurrentProject("value=fail-closed-secret-value")).rejects.toThrow(
            "SecretVaultKeyUnavailableError",
          )
        },
      })
    } finally {
      SecretVault.__testing.setExistingMaterialForTesting(undefined)
      SecretVault.__testing.setKeyPathForTesting(undefined)
      SecretVault.__testing.resetStats()
      SecretRedaction.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetStats()
    }
  })

  test("fails closed when the local vault key cannot decrypt existing material", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyFile = path.join(tmp.path, "wrong-local-secret-vault.key")
    const { project } = await Project.fromDirectory(tmp.path)

    SecretVault.__testing.setKeyPathForTesting(keyFile)
    SecretVault.__testing.setExistingMaterialForTesting(false)

    try {
      const profile = await SecretVault.createProfile({ projectID: project.id, name: "wrong-local" })
      await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "WRONG_LOCAL_SECRET",
        risk: "high",
        value: "wrong-local-secret-value",
      })
      await fs.writeFile(keyFile, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 })
      SecretVault.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetRuntimeCaches()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(SecretRedaction.forCurrentProject("value=wrong-local-secret-value")).rejects.toThrow(
            "SecretVaultKeyUnavailableError",
          )
        },
      })
    } finally {
      SecretVault.__testing.setExistingMaterialForTesting(undefined)
      SecretVault.__testing.setKeyPathForTesting(undefined)
      SecretVault.__testing.resetStats()
      SecretRedaction.__testing.resetRuntimeCaches()
      SecretRedaction.__testing.resetStats()
    }
  })

  test("stores encrypted values and exposes only safe metadata through agent routes", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const profile = await SecretVault.createProfile({ projectID: project.id, name: "dev", label: "Development" })
    const secretValue = "sk-test-secret-value"

    const entry = await SecretVault.createEntry({
      projectID: project.id,
      profileID: profile.id,
      name: "OPENAI_API_KEY",
      risk: "high",
      value: secretValue,
    })

    const row = Database.use((db) => db.select().from(SecretEntryTable).where(eq(SecretEntryTable.id, entry.id)).get())
    expect(row?.value_ciphertext).toBeString()
    expect(row?.value_ciphertext).not.toContain(secretValue)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const response = await app.request(`/secret/profiles/${profile.id}/entries?${query}`)
        expect(response.status).toBe(200)
        const body = await response.json()
        const serialized = JSON.stringify(body)
        expect(serialized).toContain("OPENAI_API_KEY")
        expect(serialized).toContain("high")
        expect(serialized).not.toContain(secretValue)
        expect(serialized).not.toContain("value_ciphertext")
        expect(serialized).not.toContain("value_iv")
        expect(serialized).not.toContain("value_tag")

        const keyRead = await app.request(
          `/file/content?directory=${encodeURIComponent(Global.Path.data)}&path=${encodeURIComponent("secret-vault.key")}`,
        )
        expect(keyRead.status).not.toBe(200)

        const symlinkPath = path.join(tmp.path, "oco-data-link")
        await fs.symlink(Global.Path.data, symlinkPath)
        const symlinkRead = await app.request(`/file/content?${query}&path=${encodeURIComponent("oco-data-link/secret-vault.key")}`)
        expect(symlinkRead.status).not.toBe(200)

        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(Global.Path.data, "secret-vault.key") }, ctx)).rejects.toThrow(
          "protected OCO internal path",
        )
        await expect(read.execute({ filePath: path.join(symlinkPath, "secret-vault.key") }, ctx)).rejects.toThrow(
          "protected OCO internal path",
        )

        await fs.rm(symlinkPath, { force: true })
        await fs.mkdir(path.join(Global.Path.data, "storage"), { recursive: true })
        await Bun.write(path.join(Global.Path.data, "storage", "secret-vault-canary.txt"), "oco-internal-canary")
        await fs.symlink(path.join(Global.Path.data, "storage"), symlinkPath)
        const grep = await GrepTool.init()
        const grepResult = await grep.execute({ pattern: "oco-internal-canary", path: tmp.path }, ctx)
        expect(grepResult.output).not.toContain("oco-internal-canary")

        const glob = await GlobTool.init()
        const globResult = await glob.execute({ pattern: "**/secret-vault-canary.txt", path: tmp.path }, ctx)
        expect(globResult.output).not.toContain("secret-vault-canary")

        await Bun.write(path.join(tmp.path, "allowed.txt"), "needle")
        const normalFind = await app.request(`/find?${query}&pattern=${encodeURIComponent("needle")}`)
        expect(normalFind.status).toBe(200)
        expect(JSON.stringify(await normalFind.json())).toContain("needle")

        const injectedPath = path.join(tmp.path, "injected-by-find")
        const injectionPattern = `needle; touch ${injectedPath}`
        const injectedFind = await app.request(`/find?${query}&pattern=${encodeURIComponent(injectionPattern)}`)
        expect(injectedFind.status).toBe(200)
        expect(await Bun.file(injectedPath).exists()).toBe(false)

        await Bun.write(path.join(tmp.path, "copied-secret.txt"), `OPENAI_API_KEY=${secretValue}\n`)
        const readSecret = await read.execute({ filePath: path.join(tmp.path, "copied-secret.txt") }, ctx)
        expect(readSecret.output).toContain("OPENAI_API_KEY")
        expect(readSecret.output).toContain("[REDACTED:OPENAI_API_KEY]")
        expect(readSecret.output).not.toContain(secretValue)

        const grepSecret = await grep.execute({ pattern: secretValue, path: tmp.path }, ctx)
        expect(grepSecret.output).toContain("[REDACTED:OPENAI_API_KEY]")
        expect(grepSecret.output).not.toContain(secretValue)

        const liveMetadata: unknown[] = []
        const bash = await BashTool.init()
        const bashResult = await bash.execute(
          { command: "printf 'OPENAI_API_KEY=%s' \"$OPENAI_API_KEY\"", description: "Prints secure env value" },
          { ...ctx, metadata: (input) => liveMetadata.push(input) },
        )
        expect(bashResult.output).toContain("OPENAI_API_KEY")
        expect(bashResult.output).toContain("[REDACTED:OPENAI_API_KEY]")
        expect(JSON.stringify(bashResult)).not.toContain(secretValue)
        expect(JSON.stringify(liveMetadata)).toContain("[REDACTED:OPENAI_API_KEY]")
        expect(JSON.stringify(liveMetadata)).not.toContain(secretValue)

        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          model: { providerID: "test", modelID: "test" },
          agent: "user",
          tools: {},
        } as unknown as MessageV2.Info)
        const persisted = await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "tool",
          callID: "call_secret",
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            title: "Secret echo",
            output: `raw ${secretValue}`,
            metadata: { output: `live ${secretValue}` },
            time: { start: Date.now(), end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
        expect(JSON.stringify(persisted)).toContain("[REDACTED:OPENAI_API_KEY]")
        expect(JSON.stringify(persisted)).not.toContain(secretValue)
        expect(JSON.stringify(await Session.messages({ sessionID: session.id }))).not.toContain(secretValue)

        const mcpResponse = await app.request(`/mcp?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "blocked-local",
            config: { type: "local", command: ["node", "server.js"], enabled: false },
          }),
        })
        expect(mcpResponse.status).toBe(200)
      },
    })

    await using otherTmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: otherTmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const otherResult = await bash.execute(
          { command: "printf '%s' \"${OPENAI_API_KEY:-missing}\"", description: "Prints missing secure env" },
          ctx,
        )
        expect(otherResult.output).not.toContain(secretValue)
        await Bun.write(path.join(otherTmp.path, "other-copy.txt"), secretValue)
        const otherRead = await (await ReadTool.init()).execute({ filePath: path.join(otherTmp.path, "other-copy.txt") }, ctx)
        expect(otherRead.output).toContain(secretValue)
        expect(otherRead.output).not.toContain("[REDACTED:OPENAI_API_KEY]")
      },
    })
  }, 30_000)

  test("isolates Secure Env routes, injection, and redaction between non-git workspace directories", async () => {
    await using workspaceA = await tmpdir()
    await using workspaceB = await tmpdir()
    const workspaceSecret = "workspace-a-secret-value"
    const legacyGlobalSecret = "legacy-global-secret-value"
    const legacyName = `LEGACY_GLOBAL_${Identifier.ascending("session").replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`

    await Project.fromDirectory(workspaceA.path)
    const globalProfile = await SecretVault.createProfile({ projectID: "global", name: Identifier.ascending("session") })
    await SecretVault.createEntry({
      projectID: "global",
      profileID: globalProfile.id,
      name: legacyName,
      risk: "production",
      value: legacyGlobalSecret,
    })

    let profileID = ""
    let entryID = ""
    const app = Server.App()

    await Instance.provide({
      directory: workspaceA.path,
      fn: async () => {
        expect(Instance.project.id).toBe("global")
        const query = `directory=${encodeURIComponent(workspaceA.path)}`
        const tokenResponse = await app.request(`/secret/admin-token?${query}`, { method: "POST" })
        expect(tokenResponse.status).toBe(200)
        const token = (await tokenResponse.json()) as SecretVault.AdminToken
        expect(token.projectID).toBe(SecretScope.currentID())
        expect(token.projectID).not.toBe("global")

        const profileResponse = await app.request(`/secret/admin/profiles?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token.token },
          body: JSON.stringify({ name: "workspace-a" }),
        })
        expect(profileResponse.status).toBe(200)
        const profile = (await profileResponse.json()) as SecretVault.Profile
        profileID = profile.id

        const createResponse = await app.request(`/secret/admin/profiles/${profile.id}/entries?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token.token },
          body: JSON.stringify({ name: "WORKSPACE_A_ONLY", risk: "high", value: workspaceSecret }),
        })
        expect(createResponse.status).toBe(200)
        const createdEntry = (await createResponse.json()) as SecretVault.Entry
        entryID = createdEntry.id
        expect(JSON.stringify(createdEntry).includes(workspaceSecret)).toBe(false)

        const profilesResponse = await app.request(`/secret/profiles?${query}`)
        expect(profilesResponse.status).toBe(200)
        const profiles = (await profilesResponse.json()) as SecretVault.Profile[]
        expect(profiles.map((item) => item.id)).toContain(profile.id)
        expect(JSON.stringify(profiles)).not.toContain(legacyName)

        const entriesResponse = await app.request(`/secret/profiles/${profile.id}/entries?${query}`)
        expect(entriesResponse.status).toBe(200)
        const entries = (await entriesResponse.json()) as SecretVault.Entry[]
        expect(entries.map((item) => item.name)).toEqual(["WORKSPACE_A_ONLY"])

        const bash = await BashTool.init()
        const bashResult = await bash.execute(
          {
            command: `printf '%s/%s' "$WORKSPACE_A_ONLY" "\${${legacyName}:-missing}"`,
            description: "Prints workspace secure env",
          },
          ctx,
        )
        expect(bashResult.output).toContain("[REDACTED:WORKSPACE_A_ONLY]")
        expect(bashResult.output).toContain("missing")
        expect(bashResult.output.includes(workspaceSecret)).toBe(false)
        expect(bashResult.output.includes(legacyGlobalSecret)).toBe(false)

        const crossWorkdirResult = await bash.execute(
          {
            command: "printf '%s' \"${WORKSPACE_A_ONLY:-missing}\"",
            workdir: workspaceB.path,
            description: "Checks secure env workdir scope",
          },
          ctx,
        )
        expect(crossWorkdirResult.output).toContain("missing")
        expect(crossWorkdirResult.output).not.toContain("[REDACTED:WORKSPACE_A_ONLY]")
        expect(crossWorkdirResult.output.includes(workspaceSecret)).toBe(false)

        const redacted = await SecretRedaction.forCurrentProject(`value=${workspaceSecret}; legacy=${legacyGlobalSecret}`)
        expect(redacted).toContain("[REDACTED:WORKSPACE_A_ONLY]")
        expect(redacted.includes(legacyGlobalSecret)).toBe(true)
      },
    })

    await Instance.provide({
      directory: workspaceB.path,
      fn: async () => {
        expect(Instance.project.id).toBe("global")
        const query = `directory=${encodeURIComponent(workspaceB.path)}`
        const profilesResponse = await app.request(`/secret/profiles?${query}`)
        expect(profilesResponse.status).toBe(200)
        expect(await profilesResponse.json()).toEqual([])

        const entriesResponse = await app.request(`/secret/profiles/${profileID}/entries?${query}`)
        expect(entriesResponse.status).toBe(404)

        const tokenResponse = await app.request(`/secret/admin-token?${query}`, { method: "POST" })
        expect(tokenResponse.status).toBe(200)
        const token = (await tokenResponse.json()) as SecretVault.AdminToken
        const deleteFromWrongWorkspace = await app.request(`/secret/admin/profiles/${profileID}/entries/${entryID}?${query}`, {
          method: "DELETE",
          headers: { "x-oco-secret-admin-token": token.token },
        })
        expect(deleteFromWrongWorkspace.status).toBe(404)

        const bash = await BashTool.init()
        const bashResult = await bash.execute(
          { command: "printf '%s' \"${WORKSPACE_A_ONLY:-missing}\"", description: "Prints missing workspace secure env" },
          ctx,
        )
        expect(bashResult.output).toContain("missing")
        expect(bashResult.output.includes(workspaceSecret)).toBe(false)
        expect(bashResult.output).not.toContain("[REDACTED:WORKSPACE_A_ONLY]")

        const unredacted = await SecretRedaction.forCurrentProject(`value=${workspaceSecret}; legacy=${legacyGlobalSecret}`)
        expect(unredacted.includes(workspaceSecret)).toBe(true)
        expect(unredacted.includes(legacyGlobalSecret)).toBe(true)
        expect(unredacted).not.toContain("[REDACTED:WORKSPACE_A_ONLY]")
      },
    })
  }, 15000)

  test("redacts session output using the non-git workspace directory scope", async () => {
    await using workspaceA = await tmpdir()
    await using workspaceB = await tmpdir()
    const sessionSecret = "session-workspace-secret-value"
    let sessionA = ""
    let sessionB = ""

    await Instance.provide({
      directory: workspaceA.path,
      fn: async () => {
        const profile = await SecretVault.createProfile({ projectID: SecretScope.currentID(), name: "session-a" })
        await SecretVault.createEntry({
          projectID: SecretScope.currentID(),
          profileID: profile.id,
          name: "SESSION_A_ONLY",
          risk: "medium",
          value: sessionSecret,
        })
        sessionA = (await Session.create({})).id
      },
    })

    await Instance.provide({
      directory: workspaceB.path,
      fn: async () => {
        sessionB = (await Session.create({})).id
      },
    })

    const redactedA = await SecretRedaction.forSession(sessionA, `value=${sessionSecret}`)
    expect(redactedA).toContain("[REDACTED:SESSION_A_ONLY]")
    expect(redactedA.includes(sessionSecret)).toBe(false)

    const redactedB = await SecretRedaction.forSession(sessionB, `value=${sessionSecret}`)
    expect(redactedB.includes(sessionSecret)).toBe(true)
    expect(redactedB).not.toContain("[REDACTED:SESSION_A_ONLY]")
  })

  test("bounds vault key and redaction material work across repeated concurrent redaction", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const profile = await SecretVault.createProfile({ projectID: project.id, name: "bulk" })
    const values = Array.from({ length: 16 }, (_, index) => `bulk-secret-value-${index}`)

    for (const [index, value] of values.entries()) {
      await SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: `BULK_SECRET_${index}`,
        risk: "medium",
        value,
      })
    }

    SecretVault.__testing.resetRuntimeCaches()
    SecretVault.__testing.resetStats()
    SecretRedaction.__testing.resetRuntimeCaches()
    SecretRedaction.__testing.resetStats()

    const redacted = await Promise.all(
      Array.from({ length: 25 }, () => SecretRedaction.forProject(project.id, `token=${values[15]}`)),
    )
    expect(redacted.every((value) => value === "token=[REDACTED:BULK_SECRET_15]")).toBe(true)
    expect(SecretVault.__testing.stats()).toEqual({ keyLoads: 1, sensitiveLoads: 1 })
    expect(SecretRedaction.__testing.stats()).toEqual({ patternLoads: 1 })

    await SecretRedaction.forProject(project.id, `token=${values[0]}`)
    expect(SecretVault.__testing.stats()).toEqual({ keyLoads: 1, sensitiveLoads: 1 })
    expect(SecretRedaction.__testing.stats()).toEqual({ patternLoads: 1 })
  })

  test("refreshes redaction and injection material after secret mutations", async () => {
    await using tmp = await tmpdir({ git: true })
    await Project.fromDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = SecretScope.currentID()
        const profile = await SecretVault.createProfile({ projectID, name: "mutable" })
        const first = "first-mutable-secret"
        const second = "second-mutable-secret"
        const third = "third-mutable-secret"
        const imported = "imported-mutable-secret"
        const entry = await SecretVault.createEntry({
          projectID,
          profileID: profile.id,
          name: "MUTABLE_SECRET",
          risk: "high",
          value: first,
        })

        expect(await SecretRedaction.forCurrentProject(`value=${first}`)).toBe("value=[REDACTED:MUTABLE_SECRET]")
        await SecretVault.updateEntry({ projectID, profileID: profile.id, entryID: entry.id, value: second })
        expect(await SecretRedaction.forCurrentProject(`old=${first}`)).toBe(`old=${first}`)
        expect(await SecretRedaction.forCurrentProject(`new=${second}`)).toBe("new=[REDACTED:MUTABLE_SECRET]")

        await SecretVault.updateEntry({ projectID, profileID: profile.id, entryID: entry.id, enabled: false })
        expect(await SecretRedaction.forCurrentProject(`disabled=${second}`)).toBe(`disabled=${second}`)

        await SecretVault.updateEntry({ projectID, profileID: profile.id, entryID: entry.id, enabled: true, value: third })
        expect(await SecretRedaction.forCurrentProject(`third=${third}`)).toBe("third=[REDACTED:MUTABLE_SECRET]")

        await SecretVault.deleteEntry({ projectID, profileID: profile.id, entryID: entry.id })
        expect(await SecretRedaction.forCurrentProject(`deleted=${third}`)).toBe(`deleted=${third}`)

        await SecretVault.importEnv({
          projectID,
          profileID: profile.id,
          content: `IMPORTED_MUTABLE_SECRET=${imported}`,
          risk: "medium",
          overwrite: true,
        })
        expect(await SecretRedaction.forCurrentProject(`imported=${imported}`)).toBe("imported=[REDACTED:IMPORTED_MUTABLE_SECRET]")

        const bash = await BashTool.init()
        const bashResult = await bash.execute(
          { command: "printf '%s' \"$IMPORTED_MUTABLE_SECRET\"", description: "Prints imported secure env" },
          ctx,
        )
        expect(bashResult.output).toBe("[REDACTED:IMPORTED_MUTABLE_SECRET]")
        expect(JSON.stringify(bashResult)).not.toContain(imported)
      },
    })
  })

  test("bash shares secure env material between injection and redaction", async () => {
    await using tmp = await tmpdir({ git: true })
    await Project.fromDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = SecretScope.currentID()
        const profile = await SecretVault.createProfile({ projectID, name: "bash" })
        await SecretVault.createEntry({
          projectID,
          profileID: profile.id,
          name: "BASH_SHARED_SECRET",
          risk: "high",
          value: "bash-shared-secret-value",
        })

        SecretVault.__testing.resetRuntimeCaches()
        SecretVault.__testing.resetStats()
        SecretRedaction.__testing.resetRuntimeCaches()
        SecretRedaction.__testing.resetStats()

        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "printf '%s' \"$BASH_SHARED_SECRET\"", description: "Prints shared secure env" },
          ctx,
        )

        expect(result.output).toBe("[REDACTED:BASH_SHARED_SECRET]")
        expect(SecretVault.__testing.stats()).toEqual({ keyLoads: 1, sensitiveLoads: 1 })
      },
    })
  })

  test("bash streaming metadata redacts boundary secrets without reprocessing unbounded output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Project.fromDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = SecretScope.currentID()
        const profile = await SecretVault.createProfile({ projectID, name: "bash-metadata" })
        const secret = "bash-metadata-boundary-secret-value"
        await SecretVault.createEntry({
          projectID,
          profileID: profile.id,
          name: "BASH_METADATA_BOUNDARY_SECRET",
          risk: "medium",
          value: secret,
        })

        const metadata: unknown[] = []
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command:
              'bun -e \'process.stdout.write("a".repeat(29995) + process.env.BASH_METADATA_BOUNDARY_SECRET + "z".repeat(10000))\'',
            description: "Prints boundary secure env",
          },
          { ...ctx, metadata: (input) => metadata.push(input) },
        )

        expect(JSON.stringify(metadata)).not.toContain(secret)
        expect(result.output).toContain("[REDACTED:BASH_METADATA_BOUNDARY_SECRET]")
        expect(result.output).not.toContain(secret)
      },
    })
  })

  test("bounds secret material refresh work during repeated streaming session updates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Project.fromDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = SecretScope.currentID()
        const profile = await SecretVault.createProfile({ projectID, name: "stream" })
        const secret = "stream-session-secret-value"
        await SecretVault.createEntry({ projectID, profileID: profile.id, name: "STREAM_SESSION_SECRET", risk: "medium", value: secret })
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          model: { providerID: "test", modelID: "test" },
          agent: "user",
          tools: {},
        } as unknown as MessageV2.Info)

        SecretVault.__testing.resetRuntimeCaches()
        SecretVault.__testing.resetStats()
        SecretRedaction.__testing.resetRuntimeCaches()
        SecretRedaction.__testing.resetStats()

        const partID = Identifier.ascending("part")
        for (let index = 0; index < 20; index++) {
          await Session.updatePart({
            part: {
              id: partID,
              messageID,
              sessionID: session.id,
              type: "text",
              text: `chunk ${index} ${secret}`,
            },
            delta: secret,
          })
        }

        expect(JSON.stringify(await Session.messages({ sessionID: session.id }))).not.toContain(secret)
        expect(SecretVault.__testing.stats()).toEqual({ keyLoads: 1, sensitiveLoads: 1 })
        expect(SecretRedaction.__testing.stats()).toEqual({ patternLoads: 1 })
      },
    })
  })

  test("rejects secure env values shorter than the redaction minimum", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const profile = await SecretVault.createProfile({ projectID: project.id, name: "dev" })

    await expect(
      SecretVault.createEntry({
        projectID: project.id,
        profileID: profile.id,
        name: "TINY_SECRET",
        risk: "medium",
        value: "short",
      }),
    ).rejects.toThrow("at least 8 characters")
  })

  test("redacts incomplete streaming suffixes rather than exposing secret prefixes", () => {
    const patterns = [{ name: "STREAM_TOKEN", marker: "[REDACTED:STREAM_TOKEN]", values: ["streaming-secret-value"] }]

    expect(SecretRedaction.applyStreaming("prefix streaming-sec", patterns)).toBe("prefix [REDACTED:STREAM_TOKEN]")
    expect(SecretRedaction.applyStreaming("prefix streaming-secret-value", patterns)).toBe("prefix [REDACTED:STREAM_TOKEN]")
  })

  test("redacts overlapping values without exposing a longer value suffix", () => {
    const patterns = [
      { name: "SHORT_TOKEN", marker: "[REDACTED:SHORT_TOKEN]", values: ["abcdefgh"] },
      { name: "LONG_TOKEN", marker: "[REDACTED:LONG_TOKEN]", values: ["abcdefghijklmnop"] },
    ]

    expect(SecretRedaction.apply("value=abcdefghijklmnop", patterns)).toBe("value=[REDACTED:LONG_TOKEN]")
  })

  test("redacts object keys as well as object values", () => {
    const patterns = [{ name: "KEY_TOKEN", marker: "[REDACTED:KEY_TOKEN]", values: ["secret-object-key"] }]

    expect(SecretRedaction.applyUnknown<Record<string, string>>({ "secret-object-key": "secret-object-key" }, patterns)).toEqual({
      "[REDACTED:KEY_TOKEN]": "[REDACTED:KEY_TOKEN]",
    })
  })

  test("admin-token mint route accepts native fetch and renderer origins, rejects mismatched browser origins", async () => {
    await using tmp = await tmpdir({ git: true })
    await Project.fromDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const query = `directory=${encodeURIComponent(tmp.path)}`

        // Native HTTP clients (Tauri tauriFetch, curl) usually omit Origin.
        // Allow them; redaction prevents model exposure regardless.
        const noOrigin = await app.request(`/secret/admin-token?${query}`, { method: "POST" })
        expect(noOrigin.status).toBe(200)
        const native = (await noOrigin.json()) as { token: string; projectID: string; expiresAt: number }
        expect(native.token).toBeString()
        expect(native.projectID).toBe(Instance.project.id)
        expect(native.expiresAt).toBeGreaterThan(Date.now())

        // Browser cross-origin fetch from a non-allow-listed origin must be rejected.
        const wrongOrigin = await app.request(`/secret/admin-token?${query}`, {
          method: "POST",
          headers: { Origin: "https://evil.example.com" },
        })
        expect(wrongOrigin.status).toBe(403)

        const local = await app.request(`/secret/admin-token?${query}`, {
          method: "POST",
          headers: { Origin: "http://localhost:5173" },
        })
        expect(local.status).toBe(200)
        const granted = (await local.json()) as { token: string; projectID: string; expiresAt: number }
        expect(granted.token).toBeString()
        expect(granted.projectID).toBe(Instance.project.id)

        const loopback = await app.request(`/secret/admin-token?${query}`, {
          method: "POST",
          headers: { Origin: "http://127.0.0.1:5173" },
        })
        expect(loopback.status).toBe(200)

        // Minted token must actually authorize protected admin routes.
        const profileResponse = await app.request(`/secret/admin/profiles?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": granted.token },
          body: JSON.stringify({ name: "panel" }),
        })
        expect(profileResponse.status).toBe(200)
      },
    })
  })

  test("rejects raw value reveal without protected admin token", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const profile = await SecretVault.createProfile({ projectID: project.id, name: "runpod" })
    const entry = await SecretVault.createEntry({
      projectID: project.id,
      profileID: profile.id,
      name: "RUNPOD_API_KEY",
      risk: "production",
      value: "runpod-secret-value",
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const denied = await app.request(`/secret/admin/profiles/${profile.id}/entries/${entry.id}/value?${query}`)
        expect(denied.status).toBe(403)

        const token = SecretVault.issueAdminToken(project.id).token
        const allowed = await app.request(`/secret/admin/profiles/${profile.id}/entries/${entry.id}/value?${query}`, {
          headers: { "x-oco-secret-admin-token": token },
        })
        expect(allowed.status).toBe(200)
        expect(await allowed.json()).toEqual({ value: "runpod-secret-value" })

        const disabled = await app.request(`/secret/admin/profiles/${profile.id}/entries/${entry.id}?${query}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token },
          body: JSON.stringify({ enabled: false, label: "Disabled token" }),
        })
        expect(disabled.status).toBe(200)
        expect(JSON.stringify(await disabled.json())).not.toContain("runpod-secret-value")

        const deleted = await app.request(`/secret/admin/profiles/${profile.id}/entries/${entry.id}?${query}`, {
          method: "DELETE",
          headers: { "x-oco-secret-admin-token": token },
        })
        expect(deleted.status).toBe(200)
        expect(await deleted.json()).toBe(true)
      },
    })
  })

  test("filters protected internal child names from directory reads and final ripgrep file buffers", async () => {
    await using tmp = await tmpdir({ git: true })
    const storageDir = path.join(Global.Path.data, "storage")
    await fs.mkdir(storageDir, { recursive: true })
    await fs.mkdir(path.join(tmp.path, "normal-dir"))
    await Bun.write(path.join(tmp.path, "allowed.txt"), "safe")
    await Bun.write(path.join(storageDir, "secret-vault-final-buffer.txt"), "internal")
    await fs.symlink(storageDir, path.join(tmp.path, "oco-storage-link"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const directory = await read.execute({ filePath: tmp.path }, ctx)
        expect(directory.output).toContain("normal-dir/")
        expect(directory.output).toContain("allowed.txt")
        expect(directory.output).not.toContain("oco-storage-link")
        expect(directory.metadata.preview).not.toContain("oco-storage-link")

        const encoder = new TextEncoder()
        const output = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("allowed.txt\noco-storage-link/secret-vault-final-buffer.txt"))
            controller.close()
          },
        })
        const files = await Array.fromAsync(Ripgrep.parseFilesOutput(tmp.path, output))
        expect(files).toEqual(["allowed.txt"])
      },
    })
  })

  test("import-env skips values below the redaction minimum without aborting the rest of the import", async () => {
    await using tmp = await tmpdir({ git: true })
    const longValue = "a-long-enough-import-secret"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const token = SecretVault.issueAdminToken(Instance.project.id).token
        const profileResponse = await app.request(`/secret/admin/profiles?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token },
          body: JSON.stringify({ name: "mixed" }),
        })
        expect(profileResponse.status).toBe(200)
        const profile = (await profileResponse.json()) as SecretVault.Profile

        const content = [
          `LONG_OK=${longValue}`,
          "TINY=abc",
          "EMPTY=",
          "# comment",
          "",
          "EXPORT_OK=export-this-value-too",
        ].join("\n")
        const importResponse = await app.request(`/secret/admin/profiles/${profile.id}/import-env?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token },
          body: JSON.stringify({ content, risk: "medium" }),
        })
        expect(importResponse.status).toBe(200)
        const imported = (await importResponse.json()) as SecretVault.Entry[]
        const names = imported.map((e) => e.name).sort()
        expect(names).toEqual(["EXPORT_OK", "LONG_OK"])
      },
    })
  })

  test("imports env-style content through protected content path without exposing values to session-shaped routes", async () => {
    await using tmp = await tmpdir({ git: true })
    const secretValue = "env-import-secret"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const token = SecretVault.issueAdminToken(Instance.project.id).token
        const profileResponse = await app.request(`/secret/admin/profiles?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token },
          body: JSON.stringify({ name: "env" }),
        })
        expect(profileResponse.status).toBe(200)
        const profile = (await profileResponse.json()) as SecretVault.Profile

        const importResponse = await app.request(`/secret/admin/profiles/${profile.id}/import-env?${query}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-oco-secret-admin-token": token },
          body: JSON.stringify({ content: `SAFE_TOKEN=${secretValue}\n# ignored`, risk: "medium" }),
        })
        expect(importResponse.status).toBe(200)
        const imported = await importResponse.json()
        expect(JSON.stringify(imported)).not.toContain(secretValue)

        const sessionResponse = await app.request(`/session?${query}`)
        expect(sessionResponse.status).toBe(200)
        expect(JSON.stringify(await sessionResponse.json())).not.toContain(secretValue)

        const values = await SecretVault.sensitiveValues(Instance.project.id)
        expect(values).toContain(secretValue)
      },
    })
  })
})
