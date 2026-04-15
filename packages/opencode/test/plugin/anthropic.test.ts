import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  AnthropicAuthPlugin,
  buildBillingHeaderValue,
  CLAUDE_CODE_IDENTITY,
  CODE_CALLBACK_URL,
  MESSAGE_USER_AGENT,
  rewriteMessageBody,
  TOKEN_URL,
} from "../../src/plugin/anthropic"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function createProvider() {
  return {
    models: {
      "claude-sonnet-4-20250514": {
        cost: {
          input: 3,
          output: 15,
          cache: {
            read: 0.3,
            write: 3.75,
          },
        },
      },
    },
  } as any
}

function createMessages() {
  return [
    {
      role: "user",
      content: [{ type: "text", text: "run bun test" }],
    },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: { command: "bun test" } }],
    },
  ]
}

function createMultiwordMessages() {
  return [
    {
      role: "user",
      content: [{ type: "text", text: "fill the browser form" }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_2",
          name: "playwright_browser_fill_form",
          input: { fields: [] },
        },
      ],
    },
  ]
}

describe("plugin.anthropic", () => {
  test("accepts modern hosted callback input for Claude Pro/Max auth", async () => {
    const plugin = await AnthropicAuthPlugin({
      client: {
        auth: {
          set: async () => undefined,
        },
      },
    } as any)

    const method = plugin.auth!.methods[0]!
    if (method.type !== "oauth") throw new Error("expected oauth method")
    const authorization = (await method.authorize()) as {
      url: string
      callback: (code: string) => Promise<any>
    }
    const authUrl = new URL(authorization.url)
    const state = authUrl.searchParams.get("state")
    let seenBody: Record<string, string> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        refresh_token: "refresh-token",
        access_token: "access-token",
        expires_in: 7200,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const result = await authorization.callback(`${CODE_CALLBACK_URL}?code=auth-code&state=${state}`)

    expect(authUrl.origin + authUrl.pathname).toBe("https://claude.ai/oauth/authorize")
    expect(authUrl.searchParams.get("redirect_uri")).toBe(CODE_CALLBACK_URL)
    expect(authUrl.searchParams.get("scope")).toContain("user:sessions:claude_code")
    expect(authUrl.searchParams.get("scope")).toContain("user:mcp_servers")
    expect(result).toMatchObject({
      type: "success",
      refresh: "refresh-token",
      access: "access-token",
    })
    expect(seenBody).toMatchObject({
      code: "auth-code",
      state,
      grant_type: "authorization_code",
      redirect_uri: CODE_CALLBACK_URL,
    })
    expect(typeof seenBody?.code_verifier).toBe("string")
  })

  test("rejects callback input with mismatched state", async () => {
    const plugin = await AnthropicAuthPlugin({
      client: {
        auth: {
          set: async () => undefined,
        },
      },
    } as any)

    const method = plugin.auth!.methods[0]!
    if (method.type !== "oauth") throw new Error("expected oauth method")
    const authorization = (await method.authorize()) as {
      callback: (code: string) => Promise<any>
    }
    let calls = 0

    globalThis.fetch = mock(async () => {
      calls += 1
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch

    const result = await authorization.callback("code=auth-code&state=wrong-state")

    expect(result).toEqual({ type: "failed" })
    expect(calls).toBe(0)
  })

  test("rewrites OAuth request bodies with billing metadata, precise prompt cleanup, and Claude-style tool names", () => {
    const messages = createMultiwordMessages()
    const rewritten = JSON.parse(
      String(
        rewriteMessageBody(
          JSON.stringify({
            system: [
              {
                type: "text",
                text: [
                  "You are OpenCode, the best coding agent on the planet.",
                  "",
                  "If the user asks for help, send them to https://github.com/anomalyco/opencode.",
                  "",
                  "When the user directly asks about OpenCode, use the WebFetch tool. The list of available docs is available at https://opencode.ai/docs.",
                  "",
                  "Project instruction: keep this line.",
                  "",
                  "Project reference: compare behavior with https://github.com/anomalyco/opencode before release.",
                  "",
                  "Project note: mirror https://opencode.ai/docs into our wiki.",
                  "",
                  "Use the environment block below as-is.",
                  "<env>",
                  "  Working directory: /tmp/project",
                  "</env>",
                  "",
                  "It is best if OpenCode honestly disagrees when needed.",
                ].join("\n"),
              },
            ],
            tools: [
              { name: "async_task", description: "Spawn background work", input_schema: { type: "object" } },
              {
                name: "playwright_browser_fill_form",
                description: "Fill browser form fields",
                input_schema: { type: "object" },
              },
            ],
            messages,
          }),
        ),
      ),
    )

    const systemText = rewritten.system.map((block: { text?: string }) => block.text ?? "").join("\n\n")

    expect(rewritten.system[0].text).toBe(buildBillingHeaderValue(messages as any))
    expect(rewritten.system[1].text).toBe(CLAUDE_CODE_IDENTITY)
    expect(systemText).not.toContain("You are OpenCode")
    expect(systemText).not.toContain("If the user asks for help, send them to https://github.com/anomalyco/opencode.")
    expect(systemText).not.toContain(
      "When the user directly asks about OpenCode, use the WebFetch tool. The list of available docs is available at https://opencode.ai/docs.",
    )
    expect(systemText).toContain("Project instruction: keep this line.")
    expect(systemText).toContain("Project reference: compare behavior with https://github.com/anomalyco/opencode before release.")
    expect(systemText).toContain("Project note: mirror https://opencode.ai/docs into our wiki.")
    expect(systemText).toContain("<env>")
    expect(systemText).toContain("if the assistant honestly disagrees")
    expect(rewritten.tools[0].name).toBe("mcp_AsyncTask")
    expect(rewritten.tools[1].name).toBe("mcp_PlaywrightBrowserFillForm")
    expect(rewritten.messages[1].content[0].name).toBe("mcp_PlaywrightBrowserFillForm")
  })

  test("adds OAuth headers, beta query flag, and strips Claude-style tool names from the streamed response", async () => {
    const auth = {
      type: "oauth" as const,
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: Date.now() + 60_000,
    }
    const provider = createProvider()
    const plugin = await AnthropicAuthPlugin({
      client: {
        auth: {
          set: async () => undefined,
        },
      },
    } as any)
    const loadAuth = plugin.auth!.loader!
    const options = (await loadAuth(async () => auth, provider)) as {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    }
    let seenUrl = ""
    let seenHeaders = new Headers()
    let seenBody: any

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = input instanceof Request ? input.url : input.toString()
      seenHeaders = new Headers(init?.headers)
      seenBody = JSON.parse(String(init?.body))
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"name":"mcp_PlaywrightBrowser'))
            controller.enqueue(encoder.encode('FillForm"}\n\n'))
            controller.close()
          },
        }),
        {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        },
      )
    }) as unknown as typeof fetch

    const response = await options.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
        "x-api-key": "should-be-removed",
      },
      body: JSON.stringify({
        system: "Project instruction: keep this.",
        tools: [
          {
            name: "playwright_browser_fill_form",
            description: "Fill browser form fields",
            input_schema: { type: "object" },
          },
        ],
        messages: createMultiwordMessages(),
      }),
    })

    const betas = seenHeaders
      .get("anthropic-beta")
      ?.split(",")
      .map((item) => item.trim())

    expect(seenUrl).toBe("https://api.anthropic.com/v1/messages?beta=true")
    expect(seenHeaders.get("authorization")).toBe("Bearer oauth-access")
    expect(seenHeaders.get("user-agent")).toBe(MESSAGE_USER_AGENT)
    expect(seenHeaders.get("x-api-key")).toBeNull()
    expect(betas).toContain("oauth-2025-04-20")
    expect(betas).toContain("interleaved-thinking-2025-05-14")
    expect(betas).toContain("fine-grained-tool-streaming-2025-05-14")
    expect(seenBody.tools[0].name).toBe("mcp_PlaywrightBrowserFillForm")
    expect(await response.text()).toContain('"name": "playwright_browser_fill_form"')
    expect(provider.models["claude-sonnet-4-20250514"].cost.input).toBe(0)
  })

  test("coordinates concurrent expired-token refreshes through one shared refresh path", async () => {
    const auth = {
      type: "oauth" as const,
      access: "",
      refresh: "stale-refresh",
      expires: 0,
    }
    const persisted: any[] = []
    const provider = createProvider()
    const plugin = await AnthropicAuthPlugin({
      client: {
        auth: {
          set: async (value: any) => {
            persisted.push(value)
            auth.access = value.body.access
            auth.refresh = value.body.refresh
            auth.expires = value.body.expires
          },
        },
      },
    } as any)
    const loadAuth = plugin.auth!.loader!
    const options = (await loadAuth(async () => auth, provider)) as {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    }
    let tokenCalls = 0
    let messageCalls = 0
    const authorizations: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === TOKEN_URL) {
        tokenCalls += 1
        if (tokenCalls === 1) {
          return new Response("temporary failure", { status: 500 })
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
        return new Response(JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }

      messageCalls += 1
      authorizations.push(new Headers(init?.headers).get("authorization") ?? "")
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch

    await Promise.all([
      options.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: "Keep this.", messages: createMessages(), tools: [] }),
      }),
      options.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: "Keep this.", messages: createMessages(), tools: [] }),
      }),
    ])

    expect(tokenCalls).toBe(2)
    expect(messageCalls).toBe(2)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].body).toMatchObject({
      type: "oauth",
      access: "fresh-access",
      refresh: "fresh-refresh",
    })
    expect(authorizations).toEqual(["Bearer fresh-access", "Bearer fresh-access"])
  })

  test("leaves manual API-key auth on the normal provider path", async () => {
    const provider = createProvider()
    const plugin = await AnthropicAuthPlugin({
      client: {
        auth: {
          set: async () => undefined,
        },
      },
    } as any)

    const loadAuth = plugin.auth!.loader!
    const options = await loadAuth(
      async () => ({
        type: "api",
        key: "anthropic-key",
      }),
      provider,
    )

    expect(options).toEqual({})
    expect(provider.models["claude-sonnet-4-20250514"].cost.input).toBe(3)
  })
})
