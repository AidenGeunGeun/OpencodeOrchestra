import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { generatePKCE } from "@openauthjs/openauth/pkce"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOOL_PREFIX = "mcp_"
const AUTH_USER_AGENT = "curl/8.7.1"
const MESSAGE_USER_AGENT = "claude-cli/2.1.2 (external, cli)"

async function authorize(mode: "max" | "console") {
  const pkce = await generatePKCE()
  const url = new URL(`https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`)

  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback")
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", pkce.verifier)

  return {
    url: url.toString(),
    verifier: pkce.verifier,
  }
}

function buildAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "User-Agent": AUTH_USER_AGENT,
  }
}

async function exchange(code: string, verifier: string) {
  const splits = code.split("#")
  const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: verifier,
    }),
  })

  if (!result.ok) return { type: "failed" as const }

  const json = (await result.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }

  return {
    type: "success" as const,
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

function mergeHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers()

  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value)
    })
  }

  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers.set(key, value)
    })
  } else if (Array.isArray(init?.headers)) {
    for (const [key, value] of init.headers) {
      if (typeof value !== "undefined") headers.set(key, String(value))
    }
  } else if (init?.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      if (typeof value !== "undefined") headers.set(key, String(value))
    }
  }

  return headers
}

function normalizeMessageBody(body: RequestInit["body"]) {
  if (!body || typeof body !== "string") return body

  try {
    const parsed = JSON.parse(body)

    if (parsed.system && Array.isArray(parsed.system)) {
      parsed.system = parsed.system.map((item: any) => {
        if (item.type !== "text" || !item.text) return item
        return {
          ...item,
          text: item.text.replace(/OpenCode/g, "Claude Code").replace(/opencode/gi, "Claude"),
        }
      })
    }

    if (parsed.tools && Array.isArray(parsed.tools)) {
      parsed.tools = parsed.tools.map((tool: any) => ({
        ...tool,
        name: tool.name ? `${TOOL_PREFIX}${tool.name}` : tool.name,
      }))
    }

    if (parsed.messages && Array.isArray(parsed.messages)) {
      parsed.messages = parsed.messages.map((message: any) => {
        if (!Array.isArray(message.content)) return message
        return {
          ...message,
          content: message.content.map((block: any) => {
            if (block.type !== "tool_use" || !block.name) return block
            return {
              ...block,
              name: `${TOOL_PREFIX}${block.name}`,
            }
          }),
        }
      })
    }

    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

function getRequestUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(input.toString())
    if (input instanceof Request) return new URL(input.url)
  } catch {}
}

function rewriteMessageRequest(input: RequestInfo | URL, url: URL) {
  if (url.pathname !== "/v1/messages" || url.searchParams.has("beta")) {
    return input
  }

  url.searchParams.set("beta", "true")
  return input instanceof Request ? new Request(url.toString(), input) : url
}

function rewriteStreamingToolNames(response: Response) {
  if (!response.body) return response

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }

      const text = decoder.decode(value, { stream: true }).replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"')
      controller.enqueue(encoder.encode(text))
    },
  })

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function AnthropicAuthPlugin({ client }: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const prefix = "You are Claude Code, Anthropic's official CLI for Claude."
      const model = (input as { model?: { providerID?: string } }).model
      if (model?.providerID !== "anthropic") return
      output.system.unshift(prefix)
      if (output.system[1]) output.system[1] = prefix + "\n\n" + output.system[1]
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }
          }

          return {
            apiKey: "",
            async fetch(input: RequestInfo | URL, init?: RequestInit) {
              const auth = await getAuth()
              if (auth.type !== "oauth") return fetch(input, init)

              if (!auth.access || auth.expires < Date.now()) {
                const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
                  method: "POST",
                  headers: buildAuthHeaders(),
                  body: JSON.stringify({
                    grant_type: "refresh_token",
                    refresh_token: auth.refresh,
                    client_id: CLIENT_ID,
                  }),
                })

                if (!response.ok) {
                  throw new Error(`Token refresh failed: ${response.status}`)
                }

                const json = (await response.json()) as {
                  refresh_token: string
                  access_token: string
                  expires_in: number
                }

                await client.auth.set({
                  path: {
                    id: "anthropic",
                  },
                  body: {
                    type: "oauth",
                    refresh: json.refresh_token,
                    access: json.access_token,
                    expires: Date.now() + json.expires_in * 1000,
                  },
                })

                auth.access = json.access_token
              }

              const headers = mergeHeaders(input, init)
              const incomingBeta = headers.get("anthropic-beta") || ""
              const mergedBetas = [...new Set(["oauth-2025-04-20", "interleaved-thinking-2025-05-14", ...incomingBeta.split(",").map((x) => x.trim()).filter(Boolean)])].join(",")

              headers.set("authorization", `Bearer ${auth.access}`)
              headers.set("anthropic-beta", mergedBetas)
              headers.set("user-agent", MESSAGE_USER_AGENT)
              headers.delete("x-api-key")

              const body = normalizeMessageBody(init?.body)
              const url = getRequestUrl(input)
              const requestInput = url ? rewriteMessageRequest(input, url) : input
              const response = await fetch(requestInput, {
                ...(init ?? {}),
                body,
                headers,
              })

              return rewriteStreamingToolNames(response)
            },
          }
        }

        return {}
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("max")
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => exchange(code, verifier),
            }
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("console")
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => {
                const credentials = await exchange(code, verifier)
                if (credentials.type === "failed") return credentials

                const result = (await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    authorization: `Bearer ${credentials.access}`,
                    "User-Agent": MESSAGE_USER_AGENT,
                  },
                }).then((r) => r.json())) as { raw_key: string }

                return { type: "success" as const, key: result.raw_key }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
