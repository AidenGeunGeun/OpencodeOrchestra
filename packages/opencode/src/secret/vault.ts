// OCO-only file: hostile-agent-safe secret vault foundation. See oco-dev skill deltas-catalog.md.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import { and, asc, Database, eq, NotFoundError } from "@/storage/db"
import { Global } from "@/global"
import { ProjectTable } from "@/project/project.sql"
import { SecretEntryTable, SecretProfileTable } from "./vault.sql"
import z from "zod"

export namespace SecretVault {
  export const Risk = z.enum(["low", "medium", "high", "production"])
  export type Risk = z.infer<typeof Risk>

  export const Profile = z
    .object({
      id: z.string(),
      projectID: z.string(),
      name: z.string(),
      label: z.string().optional(),
      enabled: z.boolean(),
      timeCreated: z.number(),
      timeUpdated: z.number(),
    })
    .meta({ ref: "SecretProfile" })
  export type Profile = z.infer<typeof Profile>

  export const Entry = z
    .object({
      id: z.string(),
      projectID: z.string(),
      profileID: z.string(),
      name: z.string(),
      label: z.string().optional(),
      risk: Risk,
      enabled: z.boolean(),
      hasValue: z.literal(true),
      timeUsed: z.number().optional(),
      timeCreated: z.number(),
      timeUpdated: z.number(),
    })
    .meta({ ref: "SecretEntry" })
  export type Entry = z.infer<typeof Entry>

  export const AdminToken = z
    .object({
      token: z.string(),
      projectID: z.string(),
      expiresAt: z.number(),
    })
    .meta({ ref: "SecretAdminToken" })
  export type AdminToken = z.infer<typeof AdminToken>

  export type SensitiveEntry = {
    projectID: string
    profileID: string
    name: string
    value: string
  }

  export const UnauthorizedError = NamedError.create(
    "SecretVaultUnauthorizedError",
    z.object({ message: z.string() }),
  )

  export const CreateProfile = z.object({
    name: z.string().min(1),
    label: z.string().min(1).optional(),
  })
  export const UpdateProfile = z.object({
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  export const CreateEntry = z.object({
    name: z.string().min(1),
    label: z.string().min(1).optional(),
    risk: Risk.default("medium"),
    value: z.string(),
  })
  export const UpdateEntry = z.object({
    name: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    risk: Risk.optional(),
    enabled: z.boolean().optional(),
    value: z.string().optional(),
  })
  export const ImportEnv = z.object({
    content: z.string(),
    overwrite: z.boolean().optional(),
    risk: Risk.default("medium"),
  })

  const keyPath = path.join(Global.Path.data, "secret-vault.key")
  const adminTokens = new Map<string, AdminToken>()
  const TOKEN_TTL = 5 * 60 * 1000
  const VALUE_VERSION = 1
  const MIN_PROTECTABLE_VALUE_LENGTH = 8

  export function assertProtectableValue(value: string) {
    if (value.length < MIN_PROTECTABLE_VALUE_LENGTH) {
      throw new Error(
        `Secure Env values must be at least ${MIN_PROTECTABLE_VALUE_LENGTH} characters long for automatic injection and redaction`,
      )
    }
  }

  async function key() {
    if (process.platform === "darwin" && !process.env.OPENCODE_TEST_HOME && !process.env.OCO_TEST_HOME) {
      const keychain = await keychainKey().catch(() => undefined)
      if (keychain) return keychain
    }
    const existing = await fs.readFile(keyPath).catch(() => undefined)
    if (existing) {
      await fs.chmod(keyPath, 0o600).catch(() => {})
      return Buffer.from(existing.toString("utf8"), "base64")
    }

    const generated = randomBytes(32)
    await fs.mkdir(path.dirname(keyPath), { recursive: true })
    await fs.writeFile(keyPath, generated.toString("base64"), { mode: 0o600 })
    await fs.chmod(keyPath, 0o600).catch(() => {})
    return generated
  }

  async function keychainKey() {
    const service = "oco.secret-vault"
    const account = os.userInfo().username || "default"
    const existing = await $`security find-generic-password -a ${account} -s ${service} -w`.quiet().nothrow().text()
    const value = existing.trim()
    if (value) return Buffer.from(value, "base64")

    const generated = randomBytes(32)
    await $`security add-generic-password -a ${account} -s ${service} -w ${generated.toString("base64")} -U`.quiet()
    return generated
  }

  async function encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", await key(), iv)
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    }
  }

  async function decrypt(row: typeof SecretEntryTable.$inferSelect) {
    const decipher = createDecipheriv("aes-256-gcm", await key(), Buffer.from(row.value_iv, "base64"))
    decipher.setAuthTag(Buffer.from(row.value_tag, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(row.value_ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
  }

  function profile(row: typeof SecretProfileTable.$inferSelect): Profile {
    return {
      id: row.id,
      projectID: row.project_id,
      name: row.name,
      label: row.label ?? undefined,
      enabled: row.enabled,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  function entry(row: typeof SecretEntryTable.$inferSelect): Entry {
    return {
      id: row.id,
      projectID: row.project_id,
      profileID: row.profile_id,
      name: row.name,
      label: row.label ?? undefined,
      risk: Risk.parse(row.risk),
      enabled: row.enabled,
      hasValue: true,
      timeUsed: row.time_used ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  async function requireProject(projectID: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get())
    if (!row) throw new NotFoundError({ message: `Project not found: ${projectID}` })
  }

  export async function listProfiles(projectID: string) {
    await requireProject(projectID)
    return Database.use((db) =>
      db
        .select()
        .from(SecretProfileTable)
        .where(eq(SecretProfileTable.project_id, projectID))
        .orderBy(asc(SecretProfileTable.name))
        .all()
        .map(profile),
    )
  }

  export async function listEntries(input: { projectID: string; profileID: string }) {
    await requireProfile(input.projectID, input.profileID)
    return Database.use((db) =>
      db
        .select()
        .from(SecretEntryTable)
        .where(and(eq(SecretEntryTable.project_id, input.projectID), eq(SecretEntryTable.profile_id, input.profileID)))
        .orderBy(asc(SecretEntryTable.name))
        .all()
        .map(entry),
    )
  }

  export async function createProfile(input: { projectID: string; name: string; label?: string }) {
    await requireProject(input.projectID)
    const row: typeof SecretProfileTable.$inferInsert = {
      id: randomUUID(),
      project_id: input.projectID,
      name: input.name,
      label: input.label,
      enabled: true,
    }
    return profile(Database.use((db) => db.insert(SecretProfileTable).values(row).returning().get()))
  }

  export async function updateProfile(input: { projectID: string; profileID: string } & z.infer<typeof UpdateProfile>) {
    await requireProfile(input.projectID, input.profileID)
    const row = Database.use((db) =>
      db
        .update(SecretProfileTable)
        .set({ name: input.name, label: input.label, enabled: input.enabled })
        .where(and(eq(SecretProfileTable.id, input.profileID), eq(SecretProfileTable.project_id, input.projectID)))
        .returning()
        .get(),
    )
    return profile(row)
  }

  export async function deleteProfile(input: { projectID: string; profileID: string }) {
    await requireProfile(input.projectID, input.profileID)
    Database.use((db) =>
      db
        .delete(SecretProfileTable)
        .where(and(eq(SecretProfileTable.id, input.profileID), eq(SecretProfileTable.project_id, input.projectID)))
        .run(),
    )
    return true
  }

  export async function createEntry(input: {
    projectID: string
    profileID: string
    name: string
    label?: string
    risk: Risk
    value: string
  }) {
    await requireProfile(input.projectID, input.profileID)
    assertProtectableValue(input.value)
    const sealed = await encrypt(input.value)
    const row: typeof SecretEntryTable.$inferInsert = {
      id: randomUUID(),
      project_id: input.projectID,
      profile_id: input.profileID,
      name: input.name,
      label: input.label,
      risk: input.risk,
      enabled: true,
      value_ciphertext: sealed.ciphertext,
      value_iv: sealed.iv,
      value_tag: sealed.tag,
      value_version: VALUE_VERSION,
    }
    return entry(Database.use((db) => db.insert(SecretEntryTable).values(row).returning().get()))
  }

  export async function updateEntry(input: { projectID: string; profileID: string; entryID: string } & z.infer<typeof UpdateEntry>) {
    await requireEntry(input.projectID, input.profileID, input.entryID)
    if (input.value !== undefined) assertProtectableValue(input.value)
    const sealed = input.value === undefined ? undefined : await encrypt(input.value)
    const row = Database.use((db) =>
      db
        .update(SecretEntryTable)
        .set({
          name: input.name,
          label: input.label,
          risk: input.risk,
          enabled: input.enabled,
          value_ciphertext: sealed?.ciphertext,
          value_iv: sealed?.iv,
          value_tag: sealed?.tag,
          value_version: sealed ? VALUE_VERSION : undefined,
        })
        .where(
          and(
            eq(SecretEntryTable.id, input.entryID),
            eq(SecretEntryTable.profile_id, input.profileID),
            eq(SecretEntryTable.project_id, input.projectID),
          ),
        )
        .returning()
        .get(),
    )
    return entry(row)
  }

  export async function deleteEntry(input: { projectID: string; profileID: string; entryID: string }) {
    await requireEntry(input.projectID, input.profileID, input.entryID)
    Database.use((db) =>
      db
        .delete(SecretEntryTable)
        .where(
          and(
            eq(SecretEntryTable.id, input.entryID),
            eq(SecretEntryTable.profile_id, input.profileID),
            eq(SecretEntryTable.project_id, input.projectID),
          ),
        )
        .run(),
    )
    return true
  }

  export async function revealValue(input: { projectID: string; profileID: string; entryID: string }) {
    const row = await requireEntry(input.projectID, input.profileID, input.entryID)
    return decrypt(row)
  }

  export async function sensitiveValues(projectID: string) {
    return sensitiveEntries(projectID).then((entries) => entries.map((entry) => entry.value))
  }

  export async function sensitiveEntries(projectID: string): Promise<SensitiveEntry[]> {
    await requireProject(projectID)
    const rows = Database.use((db) =>
      db
        .select()
        .from(SecretEntryTable)
        .where(and(eq(SecretEntryTable.project_id, projectID), eq(SecretEntryTable.enabled, true)))
        .all(),
    )
    const entries = await Promise.all(
      rows.map(async (row) => ({
        projectID: row.project_id,
        profileID: row.profile_id,
        name: row.name,
        value: await decrypt(row),
      })),
    )
    return entries.filter((entry) => entry.value.length >= MIN_PROTECTABLE_VALUE_LENGTH)
  }

  export async function hasEntries(projectID: string) {
    await requireProject(projectID)
    const row = Database.use((db) =>
      db.select({ id: SecretEntryTable.id }).from(SecretEntryTable).where(eq(SecretEntryTable.project_id, projectID)).limit(1).get(),
    )
    return Boolean(row)
  }

  export async function hasAnyEntries() {
    const row = Database.use((db) => db.select({ id: SecretEntryTable.id }).from(SecretEntryTable).limit(1).get())
    return Boolean(row)
  }

  export async function hasVaultMaterial() {
    if (await hasAnyEntries()) return true
    return fs.stat(keyPath).then(() => true).catch(() => false)
  }

  export async function importEnv(input: { projectID: string; profileID: string; content: string; overwrite?: boolean; risk: Risk }) {
    await requireProfile(input.projectID, input.profileID)
    const parsed = parseEnv(input.content)
    const result: Entry[] = []
    for (const [name, value] of parsed) {
      // Silently skip values below the redaction minimum so a single bad line
      // does not abort the whole import. The UI surfaces a "skipped" summary.
      if (value.length < MIN_PROTECTABLE_VALUE_LENGTH) continue
      const existing = Database.use((db) =>
        db
          .select()
          .from(SecretEntryTable)
          .where(and(eq(SecretEntryTable.project_id, input.projectID), eq(SecretEntryTable.profile_id, input.profileID), eq(SecretEntryTable.name, name)))
          .get(),
      )
      if (existing) {
        if (!input.overwrite) continue
        result.push(
          await updateEntry({
            projectID: input.projectID,
            profileID: input.profileID,
            entryID: existing.id,
            value,
            risk: input.risk,
          }),
        )
        continue
      }
      result.push(await createEntry({ projectID: input.projectID, profileID: input.profileID, name, value, risk: input.risk }))
    }
    return result
  }

  export function issueAdminToken(projectID: string): AdminToken {
    const token = randomBytes(32).toString("base64url")
    const grant = { token, projectID, expiresAt: Date.now() + TOKEN_TTL }
    adminTokens.set(token, grant)
    return grant
  }

  export function authorizeAdmin(projectID: string, token: string | undefined) {
    if (!token) throw new UnauthorizedError({ message: "Secret vault admin token required" })
    const grant = adminTokens.get(token)
    if (!grant || grant.expiresAt < Date.now()) {
      adminTokens.delete(token)
      throw new UnauthorizedError({ message: "Secret vault admin token expired or invalid" })
    }
    const expected = Buffer.from(grant.projectID)
    const actual = Buffer.from(projectID)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedError({ message: "Secret vault admin token is scoped to another project" })
    }
    return grant
  }

  async function requireProfile(projectID: string, profileID: string) {
    await requireProject(projectID)
    const row = Database.use((db) =>
      db
        .select()
        .from(SecretProfileTable)
        .where(and(eq(SecretProfileTable.id, profileID), eq(SecretProfileTable.project_id, projectID)))
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `Secret profile not found: ${profileID}` })
    return row
  }

  async function requireEntry(projectID: string, profileID: string, entryID: string) {
    await requireProfile(projectID, profileID)
    const row = Database.use((db) =>
      db
        .select()
        .from(SecretEntryTable)
        .where(
          and(
            eq(SecretEntryTable.id, entryID),
            eq(SecretEntryTable.profile_id, profileID),
            eq(SecretEntryTable.project_id, projectID),
          ),
        )
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `Secret entry not found: ${entryID}` })
    return row
  }

  function parseEnv(content: string) {
    const result: [string, string][] = []
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line
      const index = normalized.indexOf("=")
      if (index <= 0) continue
      const name = normalized.slice(0, index).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
      let value = normalized.slice(index + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      result.push([name, value])
    }
    return result
  }
}
