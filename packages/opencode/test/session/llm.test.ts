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

mock.module("ai", () => ({
  streamText,
  tool: mock((input) => input),
  jsonSchema: mock((input) => input),
}))

mock.module(PROVIDER_PATH, () => ({
  Provider: {
    getLanguage: mock(() => Promise.resolve({})),
    getProvider: mock(() => Promise.resolve({ id: "anthropic", options: {} })),
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
    get: mock(() => Promise.resolve({ experimental: {} })),
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
    instructions: mock(() => "instructions"),
  },
}))

mock.module(PERMISSION_PATH, () => ({
  PermissionNext: {
    disabled: mock(() => new Set()),
  },
}))

mock.module(AUTH_PATH, () => ({
  Auth: {
    get: mock(() => Promise.resolve(undefined)),
  },
}))

const { LLM } = await import("../../src/session/llm")

describe("session.llm", () => {
  beforeEach(() => {
    pluginCalls.length = 0
    streamText.mockClear()
  })

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
    await LLM.stream({
      user: { id: "message_123", tools: {} } as any,
      sessionID: "session_123",
      model: {
        id: "claude-3-7-sonnet",
        providerID: "anthropic",
        api: { id: "claude-3-7-sonnet" },
        options: {},
        headers: {},
        capabilities: { temperature: true },
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
    })

    expect(streamText).toHaveBeenCalledTimes(1)

    const paramsCall = pluginCalls.find((call) => call.hook === "chat.params")
    const headersCall = pluginCalls.find((call) => call.hook === "chat.headers")

    expect(paramsCall?.input.agent).toBe("orchestrator")
    expect(headersCall?.input.agent).toBe("orchestrator")
  })
})
