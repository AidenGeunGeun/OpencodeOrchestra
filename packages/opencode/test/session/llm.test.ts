import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { LLM } from "../../src/session/llm"

function createModel(options?: { providerID?: string; imageInput?: boolean }) {
  return {
    providerID: options?.providerID ?? "openai",
    capabilities: {
      input: {
        image: options?.imageInput ?? true,
      },
    },
  } as any
}

describe("session.llm", () => {
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

  test("enables Codex image generation for oauth OpenAI image-capable models", () => {
    expect(
      LLM.shouldEnableCodexImageGenerationTool({
        auth: { type: "oauth" } as any,
        model: createModel({ imageInput: true }),
      }),
    ).toBe(true)
  })

  test("keeps Codex image generation disabled for API-key auth", () => {
    expect(
      LLM.shouldEnableCodexImageGenerationTool({
        auth: { type: "api" } as any,
        model: createModel({ imageInput: true }),
      }),
    ).toBe(false)
  })

  test("keeps Codex image generation disabled for non-image models", () => {
    expect(
      LLM.shouldEnableCodexImageGenerationTool({
        auth: { type: "oauth" } as any,
        model: createModel({ imageInput: false }),
      }),
    ).toBe(false)
  })

  test("keeps Codex image generation disabled for non-OpenAI providers", () => {
    expect(
      LLM.shouldEnableCodexImageGenerationTool({
        auth: { type: "oauth" } as any,
        model: createModel({ providerID: "anthropic", imageInput: true }),
      }),
    ).toBe(false)
  })
})
