import { describe, expect, mock, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  type IdTokenClaims,
} from "../../src/plugin/codex"
import { OAUTH_DUMMY_KEY } from "../../src/auth"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("CodexAuthPlugin OAuth fetch", () => {
    test("rewrites FAST aliases to canonical model slugs and preserves priority tier", async () => {
      const plugin = await CodexAuthPlugin({
        client: {
          auth: {
            set: async () => undefined,
          },
        } as any,
      } as any)

      const provider = {
        models: {
          "gpt-5.4-fast": {
            id: "gpt-5.4-fast",
            providerID: "openai",
            api: {
              id: "gpt-5.4",
              url: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5.4 Fast",
            capabilities: {
              temperature: false,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 1050000, input: 922000, output: 128000 },
            status: "active",
            options: { serviceTier: "priority" },
            headers: {},
            release_date: "2026-03-05",
            variants: {},
            family: "gpt",
          },
        },
      } as any

      const auth = {
        type: "oauth" as const,
        access: "oauth-access-token",
        refresh: "oauth-refresh-token",
        expires: Date.now() + 60_000,
        accountId: "acc-123",
      }

      const loader = plugin.auth?.loader
      expect(loader).toBeDefined()
      const options = await loader!(async () => auth, provider)

      expect(provider.models["gpt-5.4-fast"]).toBeDefined()

      const originalFetch = globalThis.fetch
      let seenUrl: string | undefined
      let seenHeaders: Headers | undefined
      let seenBody: any
      const mockFetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        seenUrl = input.toString()
        seenHeaders = new Headers(init?.headers)
        seenBody = init?.body ? JSON.parse(String(init.body)) : undefined
        return new Response(JSON.stringify({ id: "resp_123", output: [], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      try {
        await options.fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OAUTH_DUMMY_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.4-fast",
            input: [],
            service_tier: "priority",
          }),
        })
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(seenUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
      expect(seenHeaders?.get("authorization")).toBe("Bearer oauth-access-token")
      expect(seenHeaders?.get("ChatGPT-Account-Id")).toBe("acc-123")
      expect(seenBody.model).toBe("gpt-5.4")
      expect(seenBody.service_tier).toBe("priority")
    })

    test("rewrites GPT-5.5 FAST aliases to canonical model slugs and preserves priority tier", async () => {
      const plugin = await CodexAuthPlugin({
        client: {
          auth: {
            set: async () => undefined,
          },
        } as any,
      } as any)

      const provider = {
        models: {
          "gpt-5.5-fast": {
            id: "gpt-5.5-fast",
            providerID: "openai",
            api: {
              id: "gpt-5.5",
              url: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5.5 Fast",
            capabilities: {
              temperature: false,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 272000, input: 272000, output: 128000 },
            status: "active",
            options: { serviceTier: "priority" },
            headers: {},
            release_date: "2026-04-23",
            variants: {},
            family: "gpt",
          },
        },
      } as any

      const auth = {
        type: "oauth" as const,
        access: "oauth-access-token",
        refresh: "oauth-refresh-token",
        expires: Date.now() + 60_000,
        accountId: "acc-123",
      }

      const loader = plugin.auth?.loader
      expect(loader).toBeDefined()
      const options = await loader!(async () => auth, provider)

      expect(provider.models["gpt-5.5-fast"]).toBeDefined()

      const originalFetch = globalThis.fetch
      let seenUrl: string | undefined
      let seenHeaders: Headers | undefined
      let seenBody: any
      const mockFetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        seenUrl = input.toString()
        seenHeaders = new Headers(init?.headers)
        seenBody = init?.body ? JSON.parse(String(init.body)) : undefined
        return new Response(JSON.stringify({ id: "resp_123", output: [], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      try {
        await options.fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OAUTH_DUMMY_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.5-fast",
            input: [],
            service_tier: "priority",
          }),
        })
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(seenUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
      expect(seenHeaders?.get("authorization")).toBe("Bearer oauth-access-token")
      expect(seenHeaders?.get("ChatGPT-Account-Id")).toBe("acc-123")
      expect(seenBody.model).toBe("gpt-5.5")
      expect(seenBody.service_tier).toBe("priority")
    })
  })
})
