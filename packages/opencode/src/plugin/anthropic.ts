/*
 * Portions of this file adapt logic from @ex-machina/opencode-anthropic-auth (MIT License).
 * Copyright (c) 2026 Ex Machina
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { createHash, randomUUID } from "node:crypto"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { generatePKCE } from "@openauthjs/openauth/pkce"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URLS = {
  console: "https://platform.claude.com/oauth/authorize",
  max: "https://claude.ai/oauth/authorize",
} as const
export const CODE_CALLBACK_URL = "https://platform.claude.com/oauth/code/callback"
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
]
const TOOL_PREFIX = "mcp_"
const AUTH_USER_AGENT = "axios/1.13.6"
export const MESSAGE_USER_AGENT = "claude-cli/2.1.87 (external, cli)"
const REQUIRED_BETAS = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"]
const CLAUDE_CODE_ENTRYPOINT = "sdk-cli"
const CLAUDE_CODE_VERSION = "2.1.87"
export const CLAUDE_CODE_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK."
const CCH_SALT = "59cf53e54c78"
const CCH_POSITIONS = [4, 7, 20]
const OPENCODE_IDENTITY_PREFIX = "You are OpenCode"
const PARAGRAPH_REMOVAL_RULES = [
  {
    anchor: "https://github.com/anomalyco/opencode",
    markers: ["If the user asks for help", "To give feedback"],
  },
  {
    anchor: "https://opencode.ai/docs",
    markers: ["When the user directly asks about OpenCode", "The list of available docs is available at"],
  },
]
const TEXT_REPLACEMENTS = [{ match: "if OpenCode honestly", replacement: "if the assistant honestly" }] as const
const TOKEN_REFRESH_RETRIES = 2
const TOKEN_REFRESH_BASE_DELAY_MS = 500
const STREAM_REWRITE_TAIL_LENGTH = 256

type CallbackInput = {
  code: string
  state: string
}

type TokenResponse = {
  refresh_token?: string
  access_token: string
  expires_in?: number
}

type OAuthAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
}

function generateState() {
  return randomUUID().replace(/-/g, "")
}

export async function authorize(mode: keyof typeof AUTHORIZE_URLS) {
  const pkce = await generatePKCE()
  const state = generateState()
  const url = new URL(AUTHORIZE_URLS[mode])

  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", CODE_CALLBACK_URL)
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "))
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)

  return {
    url: url.toString(),
    redirectUri: CODE_CALLBACK_URL,
    state,
    verifier: pkce.verifier,
  }
}

export function parseCallbackInput(input: string): CallbackInput | null {
  const trimmed = input.trim()

  try {
    const url = new URL(trimmed)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    if (code && state) {
      return { code, state }
    }
  } catch {}

  const hashSplits = trimmed.split("#")
  if (hashSplits.length === 2 && hashSplits[0] && hashSplits[1]) {
    return { code: hashSplits[0], state: hashSplits[1] }
  }

  const params = new URLSearchParams(trimmed)
  const code = params.get("code")
  const state = params.get("state")
  if (code && state) {
    return { code, state }
  }

  return null
}

function buildTokenHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent": AUTH_USER_AGENT,
  }
}

async function exchangeCode(callback: CallbackInput, verifier: string, redirectUri: string) {
  const result = await fetch(TOKEN_URL, {
    method: "POST",
    headers: buildTokenHeaders(),
    body: JSON.stringify({
      code: callback.code,
      state: callback.state,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })

  if (!result.ok) return { type: "failed" as const }

  const json = (await result.json()) as TokenResponse
  if (!json.access_token || !json.refresh_token) return { type: "failed" as const }

  return {
    type: "success" as const,
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

export async function exchange(input: string, verifier: string, redirectUri: string, expectedState?: string) {
  const callback = parseCallbackInput(input)
  if (!callback) {
    return { type: "failed" as const }
  }

  if (expectedState && callback.state !== expectedState) {
    return { type: "failed" as const }
  }

  return exchangeCode(callback, verifier, redirectUri)
}

export function mergeHeaders(input: RequestInfo | URL, init?: RequestInit) {
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

export function mergeBetaHeaders(headers: Headers) {
  const incomingBeta = headers.get("anthropic-beta") || ""
  const incomingBetas = incomingBeta
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  return [...new Set([...REQUIRED_BETAS, ...incomingBetas])].join(",")
}

export function setOAuthHeaders(headers: Headers, accessToken: string) {
  headers.set("authorization", `Bearer ${accessToken}`)
  headers.set("anthropic-beta", mergeBetaHeaders(headers))
  headers.set("user-agent", MESSAGE_USER_AGENT)
  headers.delete("x-api-key")
  return headers
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

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isTextBlock(value: unknown): value is { type: string; text: string } {
  return isRecord(value) && typeof value.type === "string" && typeof value.text === "string"
}

function isBillingHeaderBlock(value: unknown, expected?: string) {
  return isTextBlock(value) && value.text.startsWith("x-anthropic-billing-header:") && (!expected || value.text === expected)
}

function isClaudeIdentityBlock(value: unknown) {
  return isTextBlock(value) && value.text === CLAUDE_CODE_IDENTITY
}

function hasClaudeIdentity(blocks: unknown[]) {
  return isClaudeIdentityBlock(blocks[0]) || (isBillingHeaderBlock(blocks[0]) && isClaudeIdentityBlock(blocks[1]))
}

function prefixToolName(name: string) {
  const stripped = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name
  const pascal = stripped
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
  return `${TOOL_PREFIX}${pascal}`
}

function unprefixToolName(name: string) {
  if (!name.startsWith(TOOL_PREFIX)) return name
  const stripped = name.slice(TOOL_PREFIX.length)
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
}

export function stripToolPrefix(text: string) {
  return text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, (_match, name) => `"name": "${unprefixToolName(`mcp_${name}`)}"`)
}

export function sanitizeSystemText(text: string) {
  const paragraphs = text.split(/\n\n+/)
  const filtered = paragraphs.filter((paragraph) => {
    if (paragraph.includes(OPENCODE_IDENTITY_PREFIX)) {
      return false
    }

    for (const rule of PARAGRAPH_REMOVAL_RULES) {
      if (paragraph.includes(rule.anchor) && rule.markers.some((marker) => paragraph.includes(marker))) {
        return false
      }
    }

    return true
  })

  let result = filtered.join("\n\n")
  for (const rule of TEXT_REPLACEMENTS) {
    result = result.replace(rule.match, rule.replacement)
  }
  return result.trim()
}

function sanitizeSystemBlock(block: unknown): unknown[] {
  if (typeof block === "string") {
    const sanitized = sanitizeSystemText(block)
    return sanitized ? [{ type: "text", text: sanitized }] : []
  }

  if (isTextBlock(block) && block.type === "text") {
    const sanitized = sanitizeSystemText(block.text)
    return sanitized ? [{ ...block, text: sanitized }] : []
  }

  return [block]
}

export function prependClaudeCodeIdentity(system: unknown) {
  const identityBlock = {
    type: "text",
    text: CLAUDE_CODE_IDENTITY,
  }

  if (system == null) return [identityBlock]

  const normalized = Array.isArray(system)
    ? system.flatMap((item) => sanitizeSystemBlock(item))
    : sanitizeSystemBlock(system)

  if (hasClaudeIdentity(normalized)) {
    return normalized
  }

  return [identityBlock, ...normalized]
}

function extractFirstUserMessageText(messages: Array<Record<string, any>>) {
  const userMessage = messages.find((message) => message.role === "user")
  if (!userMessage) return ""

  if (typeof userMessage.content === "string") return userMessage.content

  if (Array.isArray(userMessage.content)) {
    const textBlock = userMessage.content.find((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    if (textBlock?.text) return textBlock.text
  }

  return ""
}

function computeCCH(messageText: string) {
  return createHash("sha256").update(messageText).digest("hex").slice(0, 5)
}

function computeVersionSuffix(messageText: string, version = CLAUDE_CODE_VERSION) {
  const chars = CCH_POSITIONS.map((index) => messageText[index] || "0").join("")
  return createHash("sha256")
    .update(`${CCH_SALT}${chars}${version}`)
    .digest("hex")
    .slice(0, 3)
}

export function buildBillingHeaderValue(messages: Array<Record<string, any>>) {
  const text = extractFirstUserMessageText(messages)
  const suffix = computeVersionSuffix(text)
  const cch = computeCCH(text)
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${suffix}; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; cch=${cch};`
}

export function rewriteMessageBody(body: RequestInit["body"]) {
  if (!body || typeof body !== "string") return body

  try {
    const parsed = JSON.parse(body)

    parsed.system = prependClaudeCodeIdentity(parsed.system)

    if (Array.isArray(parsed.messages) && parsed.messages.some((message: any) => message.role === "user")) {
      const billingHeader = buildBillingHeaderValue(parsed.messages)
      if (!isBillingHeaderBlock(parsed.system[0], billingHeader)) {
        parsed.system.unshift({ type: "text", text: billingHeader })
      }
    }

    if (Array.isArray(parsed.tools)) {
      parsed.tools = parsed.tools.map((tool: any) => ({
        ...tool,
        name: typeof tool?.name === "string" ? prefixToolName(tool.name) : tool?.name,
      }))
    }

    if (Array.isArray(parsed.messages)) {
      parsed.messages = parsed.messages.map((message: any) => {
        if (!Array.isArray(message.content)) return message
        return {
          ...message,
          content: message.content.map((block: any) => {
            if (block.type !== "tool_use" || typeof block.name !== "string") return block
            return {
              ...block,
              name: prefixToolName(block.name),
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

function rewriteStreamingToolNames(response: Response) {
  if (!response.body) return response

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""

  const stream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          pending += decoder.decode()
          if (pending) {
            controller.enqueue(encoder.encode(stripToolPrefix(pending)))
          }
          controller.close()
          return
        }

        pending += decoder.decode(value, { stream: true })
        const safeLength = Math.max(0, pending.length - STREAM_REWRITE_TAIL_LENGTH)
        if (safeLength === 0) {
          continue
        }

        controller.enqueue(encoder.encode(stripToolPrefix(pending.slice(0, safeLength))))
        pending = pending.slice(safeLength)
      }
    },
  })

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function isRetryableRefreshError(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  return (
    error.message.includes("fetch failed") ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function AnthropicAuthPlugin({ client }: PluginInput): Promise<Hooks> {
  return {
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

          let refreshPromise: Promise<OAuthAuth> | null = null

          const refreshAccessToken = async (currentAuth: OAuthAuth) => {
            if (!refreshPromise) {
              refreshPromise = (async () => {
                for (let attempt = 0; attempt <= TOKEN_REFRESH_RETRIES; attempt++) {
                  try {
                    if (attempt > 0) {
                      await sleep(TOKEN_REFRESH_BASE_DELAY_MS * 2 ** (attempt - 1))
                    }

                    const response = await fetch(TOKEN_URL, {
                      method: "POST",
                      headers: buildTokenHeaders(),
                      body: JSON.stringify({
                        grant_type: "refresh_token",
                        refresh_token: currentAuth.refresh,
                        client_id: CLIENT_ID,
                      }),
                    })

                    if (!response.ok) {
                      if (response.status >= 500 && attempt < TOKEN_REFRESH_RETRIES) {
                        await response.body?.cancel()
                        continue
                      }

                      const body = await response.text().catch(() => "")
                      throw new Error(`Token refresh failed: ${response.status}${body ? ` - ${body}` : ""}`)
                    }

                    const json = (await response.json()) as TokenResponse
                    if (!json.access_token) {
                      throw new Error("Token refresh response missing access token")
                    }
                    const nextAuth: OAuthAuth = {
                      type: "oauth",
                      refresh: json.refresh_token ?? currentAuth.refresh,
                      access: json.access_token,
                      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
                    }

                    await client.auth.set({
                      path: {
                        id: "anthropic",
                      },
                      body: nextAuth,
                    })

                    return nextAuth
                  } catch (error) {
                    if (attempt < TOKEN_REFRESH_RETRIES && isRetryableRefreshError(error)) {
                      continue
                    }
                    throw error
                  }
                }

                throw new Error("Token refresh exhausted all retries")
              })().finally(() => {
                refreshPromise = null
              })
            }

            return refreshPromise
          }

          return {
            apiKey: "",
            async fetch(input: RequestInfo | URL, init?: RequestInit) {
              const currentAuth = await getAuth()
              if (currentAuth.type !== "oauth") return fetch(input, init)

              if (!currentAuth.access || !currentAuth.expires || currentAuth.expires < Date.now()) {
                const refreshed = await refreshAccessToken(currentAuth as OAuthAuth)
                currentAuth.access = refreshed.access
                currentAuth.refresh = refreshed.refresh
                currentAuth.expires = refreshed.expires
              }

              const headers = mergeHeaders(input, init)
              setOAuthHeaders(headers, currentAuth.access)

              const body = rewriteMessageBody(init?.body)
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
            const result = await authorize("max")
            return {
              url: result.url,
              instructions: "Paste the authorization code here:",
              method: "code" as const,
              callback: async (code: string) => exchange(code, result.verifier, result.redirectUri, result.state),
            }
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const result = await authorize("console")
            return {
              url: result.url,
              instructions: "Paste the authorization code here:",
              method: "code" as const,
              callback: async (code: string) => {
                const credentials = await exchange(code, result.verifier, result.redirectUri, result.state)
                if (credentials.type === "failed") return credentials

                const apiKey = (await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    authorization: `Bearer ${credentials.access}`,
                  },
                }).then((response) => response.json())) as { raw_key: string }

                return { type: "success" as const, key: apiKey.raw_key }
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
