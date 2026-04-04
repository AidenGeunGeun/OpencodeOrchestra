import { describe, expect, test } from "bun:test"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2"
import { getLastUserMessage, resolveSessionModelSelection } from "./session-model-helpers"

const model = (modelID: string, providerID = "anthropic") => ({ providerID, modelID })

const userMessage = (input?: Partial<Pick<UserMessage, "id" | "agent" | "model" | "variant">>) =>
  ({
    id: input?.id ?? "user",
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: input?.agent ?? "build",
    model: input?.model ?? model("claude-sonnet-4"),
    variant: input?.variant,
  }) as UserMessage

const assistantMessage = (id = "assistant") =>
  ({
    id,
    sessionID: "session",
    role: "assistant",
    time: { created: 1 },
  }) as Message

describe("getLastUserMessage", () => {
  test("returns the most recent user message", () => {
    const result = getLastUserMessage([
      userMessage({ id: "user-1", model: model("claude-haiku-4") }),
      assistantMessage(),
      userMessage({ id: "user-2", model: model("claude-sonnet-4"), variant: "high" }),
    ])

    expect(result).toEqual(userMessage({ id: "user-2", model: model("claude-sonnet-4"), variant: "high" }))
  })

  test("returns undefined when there are no user messages", () => {
    expect(getLastUserMessage([assistantMessage()])).toBeUndefined()
  })

  test("ignores user messages at or after the revert point", () => {
    const result = getLastUserMessage(
      [
        userMessage({ id: "user-1", model: model("claude-haiku-4") }),
        assistantMessage("assistant-1"),
        userMessage({ id: "user-2", model: model("gpt-5", "openai"), variant: "high" }),
      ],
      "user-2",
    )

    expect(result).toEqual(userMessage({ id: "user-1", model: model("claude-haiku-4") }))
  })
})

describe("resolveSessionModelSelection", () => {
  test("keeps the session override while messages are still loading", () => {
    const result = resolveSessionModelSelection({
      session: {
        model: model("gpt-5", "openai"),
        variant: "low",
      },
      messages: undefined,
      agent: {
        model: model("claude-opus-4"),
        variant: "medium",
      },
      fallback: model("claude-haiku-4"),
    })

    expect(result).toEqual({
      model: model("gpt-5", "openai"),
      variant: "low",
    })
  })

  test("keeps submit handoff only until messages load", () => {
    const loading = resolveSessionModelSelection({
      session: {
        model: model("gpt-5", "openai"),
        variant: "low",
        source: "submit",
      },
      messages: undefined,
      fallback: model("claude-haiku-4"),
    })

    expect(loading).toEqual({
      model: model("gpt-5", "openai"),
      variant: "low",
    })

    const loaded = resolveSessionModelSelection({
      session: {
        model: model("gpt-5", "openai"),
        variant: "low",
        source: "submit",
      },
      messages: [userMessage({ model: model("claude-sonnet-4"), variant: "high" })],
      fallback: model("claude-haiku-4"),
    })

    expect(loaded).toEqual({
      model: model("claude-sonnet-4"),
      variant: "high",
    })
  })

  test("prefers the explicit session override", () => {
    const result = resolveSessionModelSelection({
      session: {
        model: model("gpt-5", "openai"),
        variant: "low",
      },
      messages: [userMessage({ model: model("claude-sonnet-4"), variant: "high" })],
      agent: {
        model: model("claude-opus-4"),
        variant: "medium",
      },
      fallback: model("claude-haiku-4"),
    })

    expect(result).toEqual({
      model: model("gpt-5", "openai"),
      variant: "low",
    })
  })

  test("falls back to the last user message", () => {
    const result = resolveSessionModelSelection({
      messages: [
        userMessage({ model: model("claude-haiku-4") }),
        assistantMessage(),
        userMessage({ model: model("claude-sonnet-4"), variant: "high" }),
      ],
      agent: {
        model: model("claude-opus-4"),
        variant: "medium",
      },
      fallback: model("gpt-5", "openai"),
    })

    expect(result).toEqual({
      model: model("claude-sonnet-4"),
      variant: "high",
    })
  })

  test("falls back to the agent default for empty sessions", () => {
    const result = resolveSessionModelSelection({
      messages: [],
      agent: {
        model: model("claude-sonnet-4"),
        variant: "high",
      },
      fallback: model("gpt-5", "openai"),
    })

    expect(result).toEqual({
      model: model("claude-sonnet-4"),
      variant: "high",
    })
  })

  test("uses the fallback model when no session or agent model exists", () => {
    const result = resolveSessionModelSelection({
      messages: [],
      fallback: model("gpt-5", "openai"),
    })

    expect(result).toEqual({
      model: model("gpt-5", "openai"),
      variant: undefined,
    })
  })

  test("skips invalid models before falling back", () => {
    const invalid = new Set(["openai/gpt-5", "anthropic/claude-sonnet-4"])
    const result = resolveSessionModelSelection({
      session: {
        model: model("gpt-5", "openai"),
        variant: "low",
      },
      messages: [userMessage({ model: model("claude-sonnet-4"), variant: "high" })],
      agent: {
        model: model("claude-haiku-4"),
        variant: "medium",
      },
      fallback: model("gemini-2.5-pro", "google"),
      isModelValid(value) {
        return !invalid.has(`${value.providerID}/${value.modelID}`)
      },
    })

    expect(result).toEqual({
      model: model("claude-haiku-4"),
      variant: "medium",
    })
  })
})
