import { describe, expect, test } from "bun:test"
import { LLM } from "./llm"

describe("LLM non-streaming adapter", () => {
  test("keeps the opt-in flag internal", () => {
    expect(LLM.shouldUseNonStreaming({ experimentalNonStreamingToolCalls: true })).toBe(true)
    expect(LLM.shouldUseNonStreaming({ experimentalNonStreamingToolCalls: false })).toBe(false)
  })

  test("adapts complete tool calls into session stream events", async () => {
    const result = {
      steps: [
        {
          request: {},
          warnings: undefined,
          content: [
            { type: "text", text: "I will inspect it." },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "read",
              input: { filePath: "README.md" },
            },
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "read",
              input: { filePath: "README.md" },
              output: { output: "ok", title: "README.md", metadata: {} },
            },
          ],
          response: {},
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          providerMetadata: undefined,
        },
      ],
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
      totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }

    const events = []
    for await (const event of LLM.nonStreamingFullStream(result as any)) {
      events.push(event)
    }

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-end",
      "tool-call",
      "tool-result",
      "finish-step",
      "finish",
    ])
    expect(events.find((event) => event.type === "tool-call")).toMatchObject({
      toolCallId: "call_1",
      toolName: "read",
      input: { filePath: "README.md" },
    })
  })

  test("falls back to result-level content when result.steps is empty", async () => {
    // Regression: persistent orchestrator subagent generateText() calls
    // were observed to return with result.steps == [] while the
    // result-level content/usage/finishReason were populated. The
    // adapter must synthesize a step from those top-level fields so
    // the session processor persists text/tool/finish-step parts
    // to SQLite. Without this fallback, the subagent's assistant
    // message ended up as an empty shell with only a step-start.
    const result = {
      steps: [],
      content: [
        { type: "text", text: "I will create the file now." },
        {
          type: "tool-call",
          toolCallId: "call_fallback",
          toolName: "write",
          input: { filePath: "orchestration_check.txt" },
        },
      ],
      request: {},
      response: {},
      warnings: [],
      providerMetadata: undefined,
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
      usage: { inputTokens: 42, outputTokens: 7, totalTokens: 49 },
      totalUsage: { inputTokens: 42, outputTokens: 7, totalTokens: 49 },
    }

    const events = []
    for await (const event of LLM.nonStreamingFullStream(result as any)) {
      events.push(event)
    }

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-end",
      "tool-call",
      "finish-step",
      "finish",
    ])
    const finishStep = events.find((event) => event.type === "finish-step") as any
    expect(finishStep.usage).toMatchObject({ inputTokens: 42, outputTokens: 7 })
    expect(finishStep.finishReason).toBe("tool-calls")
    expect(events.find((event) => event.type === "tool-call")).toMatchObject({
      toolCallId: "call_fallback",
      toolName: "write",
    })
  })

  test("synthesizes only a finish-step when both steps and content are empty", async () => {
    // Even when the result contains no parts (e.g., the model produced
    // an empty response), the adapter must still emit a finish-step so
    // the session processor records usage/finishReason rather than
    // leaving the assistant message as a bare step-start shell.
    const result = {
      steps: [],
      content: [],
      request: {},
      response: {},
      warnings: [],
      providerMetadata: undefined,
      finishReason: "stop",
      rawFinishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      totalUsage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
    }

    const events = []
    for await (const event of LLM.nonStreamingFullStream(result as any)) {
      events.push(event)
    }

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "start-step",
      "finish-step",
      "finish",
    ])
    const finishStep = events.find((event) => event.type === "finish-step") as any
    expect(finishStep.usage).toMatchObject({ inputTokens: 5, outputTokens: 0 })
    expect(finishStep.finishReason).toBe("stop")
  })

  test("emits the first step boundary before non-streaming generation completes", async () => {
    let resolveResult: (value: any) => void = () => {}
    const result = new Promise<any>((resolve) => {
      resolveResult = resolve
    })
    const stream = LLM.nonStreamingFullStreamFromPromise(result)

    expect((await stream.next()).value).toMatchObject({ type: "start" })
    expect((await stream.next()).value).toMatchObject({ type: "start-step" })

    resolveResult({
      steps: [
        {
          request: {},
          warnings: undefined,
          content: [],
          response: {},
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: "stop",
          rawFinishReason: "stop",
          providerMetadata: undefined,
        },
      ],
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })

    expect((await stream.next()).value).toMatchObject({ type: "finish-step" })
  })
})
