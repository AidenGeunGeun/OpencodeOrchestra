// OCO-only file: secret vault API boundary. See oco-dev skill deltas-catalog.md.
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { SecretScope } from "@/secret/scope"
import { SecretVault } from "@/secret/vault"
import { lazy } from "@/util/lazy"
import { errors } from "../error"

function scopeID() {
  return SecretScope.currentID()
}

function authorize(token: string | undefined) {
  try {
    SecretVault.authorizeAdmin(scopeID(), token)
    return undefined
  } catch (error) {
    return error
  }
}

// Returns true if the request Origin header matches the renderer's expected
// origin (localhost / 127.0.0.1 / *.opencode.ai). Mirrors the CORS allow-list
// in server.ts.
//
// Threat model note: this is defense-in-depth, not a fortress. The real
// protection against model-driven exfiltration of secret values is the
// SecretRedaction layer applied to all model-visible tool output. This Origin
// check exists to filter cross-origin browser misuse (where browsers always
// set Origin on cross-origin fetch). Native HTTP clients such as Tauri's
// `tauriFetch` and shell `curl` typically do not set Origin at all; for those
// we allow the request and rely on the redaction layer.
function isAllowedOrigin(origin: string) {
  if (origin.startsWith("http://localhost:") || origin === "http://localhost") return true
  if (origin.startsWith("http://127.0.0.1:") || origin === "http://127.0.0.1") return true
  if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(origin)) return true
  return false
}

export const SecretRoutes = lazy(() =>
  new Hono()
    .get(
      "/profiles",
      describeRoute({
        summary: "List secret profiles",
        description: "List agent-safe project secret profiles without secret values or value-derived hints.",
        operationId: "secret.profiles",
        responses: {
          200: {
            description: "Secret profiles",
            content: { "application/json": { schema: resolver(SecretVault.Profile.array()) } },
          },
        },
      }),
      async (c) => c.json(await SecretVault.listProfiles(scopeID())),
    )
    .post(
      "/admin-token",
      describeRoute({
        summary: "Mint secret-vault admin token",
        description:
          "Mints a short-lived admin token for the desktop renderer so it can call protected /secret/admin/* routes (create/update/delete entries, reveal value, import-env). " +
          "Gated by an Origin header check that mirrors the server's CORS allow-list. " +
          "Note: the Origin gate is defense-in-depth only. The real protection that prevents agent models from seeing stored secret values is the SecretRedaction layer applied to all model-visible tool output. " +
          "This route exists so the renderer can manage entries without each click round-tripping a separate auth handshake.",
        operationId: "secret.adminToken",
        responses: {
          200: {
            description: "Admin token",
            content: { "application/json": { schema: resolver(SecretVault.AdminToken) } },
          },
        },
      }),
      async (c) => {
        const origin = c.req.header("Origin")
        // Browsers always set Origin on cross-origin fetch. If Origin is set
        // and does not match the renderer's allow-list, reject. Native HTTP
        // clients (Tauri tauriFetch, curl) typically omit Origin and are
        // allowed; redaction prevents model exposure regardless.
        if (origin && !isAllowedOrigin(origin)) {
          return c.json({ message: "Admin token mint requires a renderer-origin request" }, 403)
        }
        return c.json(SecretVault.issueAdminToken(scopeID()))
      },
    )
    .get(
      "/profiles/:profileID/entries",
      describeRoute({
        summary: "List secret entries",
        description: "List agent-safe project secret entry metadata without secret values or value-derived hints.",
        operationId: "secret.entries",
        responses: {
          200: {
            description: "Secret entries",
            content: { "application/json": { schema: resolver(SecretVault.Entry.array()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ profileID: z.string() })),
      async (c) => {
        const { profileID } = c.req.valid("param")
        return c.json(await SecretVault.listEntries({ projectID: scopeID(), profileID }))
      },
    )
    .use("/admin/*", async (c, next) => {
      const error = authorize(c.req.header("x-oco-secret-admin-token"))
      if (error) return c.json({ message: error instanceof Error ? error.message : "Unauthorized" }, 403)
      return next()
    })
    .post(
      "/admin/profiles",
      describeRoute({
        summary: "Create secret profile",
        description: "Protected human/admin route for creating a project-scoped secret profile.",
        operationId: "secret.admin.profile.create",
        responses: { 200: { description: "Secret profile", content: { "application/json": { schema: resolver(SecretVault.Profile) } } }, ...errors(400) },
      }),
      validator("json", SecretVault.CreateProfile),
      async (c) => c.json(await SecretVault.createProfile({ projectID: scopeID(), ...c.req.valid("json") })),
    )
    .patch(
      "/admin/profiles/:profileID",
      describeRoute({
        summary: "Update secret profile",
        description: "Protected human/admin route for renaming or disabling a secret profile.",
        operationId: "secret.admin.profile.update",
        responses: { 200: { description: "Secret profile", content: { "application/json": { schema: resolver(SecretVault.Profile) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ profileID: z.string() })),
      validator("json", SecretVault.UpdateProfile),
      async (c) => c.json(await SecretVault.updateProfile({ projectID: scopeID(), profileID: c.req.valid("param").profileID, ...c.req.valid("json") })),
    )
    .delete(
      "/admin/profiles/:profileID",
      describeRoute({
        summary: "Delete secret profile",
        description: "Protected human/admin route for deleting a secret profile and its entries.",
        operationId: "secret.admin.profile.delete",
        responses: { 200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } }, ...errors(404) },
      }),
      validator("param", z.object({ profileID: z.string() })),
      async (c) => c.json(await SecretVault.deleteProfile({ projectID: scopeID(), profileID: c.req.valid("param").profileID })),
    )
    .post(
      "/admin/profiles/:profileID/entries",
      describeRoute({
        summary: "Create secret entry",
        description: "Protected human/admin route for creating a named secret value.",
        operationId: "secret.admin.entry.create",
        responses: { 200: { description: "Secret entry", content: { "application/json": { schema: resolver(SecretVault.Entry) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ profileID: z.string() })),
      validator("json", SecretVault.CreateEntry),
      async (c) => c.json(await SecretVault.createEntry({ projectID: scopeID(), profileID: c.req.valid("param").profileID, ...c.req.valid("json") })),
    )
    .patch(
      "/admin/profiles/:profileID/entries/:entryID",
      describeRoute({
        summary: "Update secret entry",
        description: "Protected human/admin route for updating metadata, disabled state, or value for a secret entry.",
        operationId: "secret.admin.entry.update",
        responses: { 200: { description: "Secret entry", content: { "application/json": { schema: resolver(SecretVault.Entry) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ profileID: z.string(), entryID: z.string() })),
      validator("json", SecretVault.UpdateEntry),
      async (c) => {
        const { profileID, entryID } = c.req.valid("param")
        return c.json(await SecretVault.updateEntry({ projectID: scopeID(), profileID, entryID, ...c.req.valid("json") }))
      },
    )
    .delete(
      "/admin/profiles/:profileID/entries/:entryID",
      describeRoute({
        summary: "Delete secret entry",
        description: "Protected human/admin route for deleting a secret entry.",
        operationId: "secret.admin.entry.delete",
        responses: { 200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } }, ...errors(404) },
      }),
      validator("param", z.object({ profileID: z.string(), entryID: z.string() })),
      async (c) => {
        const { profileID, entryID } = c.req.valid("param")
        return c.json(await SecretVault.deleteEntry({ projectID: scopeID(), profileID, entryID }))
      },
    )
    .get(
      "/admin/profiles/:profileID/entries/:entryID/value",
      describeRoute({
        summary: "Reveal secret value",
        description: "Protected human/admin route for intentionally revealing a secret value.",
        operationId: "secret.admin.entry.value",
        responses: { 200: { description: "Secret value", content: { "application/json": { schema: resolver(z.object({ value: z.string() })) } } }, ...errors(404) },
      }),
      validator("param", z.object({ profileID: z.string(), entryID: z.string() })),
      async (c) => {
        const { profileID, entryID } = c.req.valid("param")
        return c.json({ value: await SecretVault.revealValue({ projectID: scopeID(), profileID, entryID }) })
      },
    )
    .post(
      "/admin/profiles/:profileID/import-env",
      describeRoute({
        summary: "Import env content",
        description: "Protected human/admin route for importing .env-style content without exposing raw files to agents.",
        operationId: "secret.admin.import.env",
        responses: { 200: { description: "Imported secret entries", content: { "application/json": { schema: resolver(SecretVault.Entry.array()) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ profileID: z.string() })),
      validator("json", SecretVault.ImportEnv),
      async (c) => c.json(await SecretVault.importEnv({ projectID: scopeID(), profileID: c.req.valid("param").profileID, ...c.req.valid("json") })),
    ),
)
