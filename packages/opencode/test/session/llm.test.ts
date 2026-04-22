import { beforeEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import type { ModelMessage } from "ai"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const PROVIDER_PATH = path.join(SRC_ROOT, "provider/provider.ts")
const TRANSFORM_PATH = path.join(SRC_ROOT, "provider/transform.ts")
const CONFIG_PATH = path.join(SRC_ROOT, "config/config.ts")
const PLUGIN_PATH = path.join(SRC_ROOT, "plugin/index.ts")
const SYSTEM_PATH = path.join(SRC_ROOT, "session/system.ts")
const PERMISSION_PATH = path.join(SRC_ROOT, "permission/next.ts")
const AUTH_PATH = path.join(SRC_ROOT, "auth/index.ts")

const streamText = mock(() => Promise.resolve({ ok: true }))
const pluginCalls: Array<{ hook: string; input: Record<string, unknown> }> = []
let currentConfig: Record<string, unknown> = { experimental: {} }
let currentProvider = { id: "anthropic", options: {} }
let currentAuth: Record<string, unknown> | undefined
const IMAGE_GUIDANCE_MARKER =
  "The `image_generation` tool generates PNG images using OpenAI's image model."

mock.module("ai", () => ({
  streamText,
  tool: mock((input) => input),
  jsonSchema: mock((input) => input),
}))

mock.module(PROVIDER_PATH, () => ({
  Provider: {
    getLanguage: mock(() => Promise.resolve({})),
    getProvider: mock(() => Promise.resolve(currentProvider)),
  },
}))

mock.module(TRANSFORM_PATH, () => ({
  ProviderTransform: {
    OUTPUT_TOKEN_MAX: 32000,
    options: mock(() => ({})),
    smallOptions: mock(() => ({})),
    temperature: mock(() => 0.2),
    topP: mock(() => 0.9),
    topK: mock(() => 40),
    maxOutputTokens: mock(() => 4096),
    message: mock((messages) => messages),
    providerOptions: mock((_model, options) => options),
  },
}))

mock.module(CONFIG_PATH, () => ({
  Config: {
    get: mock(() => Promise.resolve(currentConfig)),
  },
}))

mock.module(PLUGIN_PATH, () => ({
  Plugin: {
    trigger: mock(async (hook, input, output) => {
      pluginCalls.push({ hook, input })
      if (hook === "chat.headers") return { headers: {} }
      return output
    }),
  },
}))

mock.module(SYSTEM_PATH, () => ({
  SystemPrompt: {
    provider: mock(() => ["provider prompt"]),
    instructions: mock((options?: { codexImageGeneration?: boolean }) =>
      options?.codexImageGeneration ? `instructions\n\n${IMAGE_GUIDANCE_MARKER}` : "instructions",
    ),
  },
}))

mock.module(PERMISSION_PATH, () => ({
  PermissionNext: {
    disabled: mock(() => new Set()),
  },
}))

mock.module(AUTH_PATH, () => ({
  Auth: {
    get: mock(() => Promise.resolve(currentAuth)),
  },
}))

const { LLM } = await import("../../src/session/llm")

describe("session.llm", () => {
  beforeEach(() => {
    pluginCalls.length = 0
    streamText.mockClear()
    currentConfig = { experimental: {} }
    currentProvider = { id: "anthropic", options: {} }
    currentAuth = undefined
  })

  function createStreamInput(overrides: Record<string, unknown> = {}) {
    return {
      user: { id: "message_123", tools: {} } as any,
      sessionID: "session_123",
      model: {
        id: "claude-3-7-sonnet",
        providerID: "anthropic",
        api: { id: "claude-3-7-sonnet" },
        options: {},
        headers: {},
        capabilities: {
          temperature: true,
          input: { image: false },
        },
      } as any,
      agent: {
        name: "orchestrator",
        mode: "subagent",
        permission: [],
        options: {},
      } as any,
      system: [],
      abort: new AbortController().signal,
      messages: [],
      tools: {},
      ...overrides,
    }
  }

  async function streamAndCapture(overrides: Record<string, unknown> = {}) {
    await LLM.stream(createStreamInput(overrides) as any)
    const calls = streamText.mock.calls as unknown as Array<[Record<string, any>]>
    return calls.at(-1)?.[0] ?? {}
  }

  test("hasToolCalls returns false for empty messages array", () => {
    expect(LLM.hasToolCalls([])).toBe(false)
  })

  test("hasToolCalls returns false for messages with only text content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]

    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("hasToolCalls returns true when messages contain tool-call", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Run a command" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]

    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("hasToolCalls returns true when messages contain tool-result", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]

    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("hasToolCalls returns false for messages with string content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "Hello world",
      },
      {
        role: "assistant",
        content: "Hi there",
      },
    ]

    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("hasToolCalls returns true when tool-call is mixed with text content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run that command" },
          {
            type: "tool-call",
            toolCallId: "call-456",
            toolName: "read",
          },
        ],
      },
    ] as ModelMessage[]

    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("passes the agent name string to chat plugin hooks", async () => {
    await LLM.stream(createStreamInput() as any)

    expect(streamText).toHaveBeenCalledTimes(1)

    const paramsCall = pluginCalls.find((call) => call.hook === "chat.params")
    const headersCall = pluginCalls.find((call) => call.hook === "chat.headers")

    expect(paramsCall?.input.agent).toBe("orchestrator")
    expect(headersCall?.input.agent).toBe("orchestrator")
  })

  test("adds image_generation tool and guidance for Codex OAuth image-capable models when flag is on", async () => {
    currentProvider = { id: "openai", options: {} }
    currentAuth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() + 60_000 }
    currentConfig = { experimental: { codex_image_generation: true } }

    const request = await streamAndCapture({
      model: {
        id: "gpt-5.4",
        providerID: "openai",
        api: { id: "gpt-5.4" },
        options: {},
        headers: {},
        capabilities: {
          temperature: false,
          input: { image: true },
        },
      },
    })

    expect(request.tools.image_generation).toMatchObject({
      type: "provider",
      id: "openai.image_generation",
      args: {},
    })
    expect(request.activeTools).toContain("image_generation")
    expect(request.providerOptions.instructions).toContain(IMAGE_GUIDANCE_MARKER)
  })

  test("keeps image_generation tool and guidance out when the flag is off", async () => {
    currentProvider = { id: "openai", options: {} }
    currentAuth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() + 60_000 }

    const request = await streamAndCapture({
      model: {
        id: "gpt-5.4",
        providerID: "openai",
        api: { id: "gpt-5.4" },
        options: {},
        headers: {},
        capabilities: {
          temperature: false,
          input: { image: true },
        },
      },
    })

    expect(request.tools.image_generation).toBeUndefined()
    expect(request.activeTools).not.toContain("image_generation")
    expect(request.providerOptions.instructions).not.toContain(IMAGE_GUIDANCE_MARKER)
  })

  test("keeps image_generation tool and guidance out for API-key OpenAI auth", async () => {
    currentProvider = { id: "openai", options: {} }
    currentAuth = { type: "api", key: "sk-test" }
    currentConfig = { experimental: { codex_image_generation: true } }

    const request = await streamAndCapture({
      model: {
        id: "gpt-5.4",
        providerID: "openai",
        api: { id: "gpt-5.4" },
        options: {},
        headers: {},
        capabilities: {
          temperature: false,
          input: { image: true },
        },
      },
    })

    expect(request.tools.image_generation).toBeUndefined()
    expect(request.activeTools).not.toContain("image_generation")
    expect(request.providerOptions.instructions).toBeUndefined()
  })

  test("keeps image_generation tool and guidance out for Codex models without image input", async () => {
    currentProvider = { id: "openai", options: {} }
    currentAuth = { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() + 60_000 }
    currentConfig = { experimental: { codex_image_generation: true } }

    const request = await streamAndCapture({
      model: {
        id: "gpt-5.3-codex-spark",
        providerID: "openai",
        api: { id: "gpt-5.3-codex-spark" },
        options: {},
        headers: {},
        capabilities: {
          temperature: false,
          input: { image: false },
        },
      },
    })

    expect(request.tools.image_generation).toBeUndefined()
    expect(request.activeTools).not.toContain("image_generation")
    expect(request.providerOptions.instructions).not.toContain(IMAGE_GUIDANCE_MARKER)
  })
})
