import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createModuleMockRestorer } from "../fixture/module-mock"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const CONFIG_PATH = path.join(SRC_ROOT, "config/config.ts")
const BUS_PATH = path.join(SRC_ROOT, "bus/index.ts")
const LLM_PATH = path.join(SRC_ROOT, "session/llm.ts")
const MESSAGE_V2_PATH = path.join(SRC_ROOT, "session/message-v2.ts")
const PLUGIN_PATH = path.join(SRC_ROOT, "plugin/index.ts")
const PROMPT_PATH = path.join(SRC_ROOT, "session/prompt.ts")
const COMPACTION_PATH = path.join(SRC_ROOT, "session/compaction.ts")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const SUMMARY_PATH = path.join(SRC_ROOT, "session/summary.ts")
const SNAPSHOT_PATH = path.join(SRC_ROOT, "snapshot/index.ts")
const STATUS_PATH = path.join(SRC_ROOT, "session/status.ts")
const restoreModuleMocks = await createModuleMockRestorer([
  BUS_PATH,
  CONFIG_PATH,
  LLM_PATH,
  MESSAGE_V2_PATH,
  PLUGIN_PATH,
  PROMPT_PATH,
  COMPACTION_PATH,
  SESSION_PATH,
  SUMMARY_PATH,
  SNAPSHOT_PATH,
  STATUS_PATH,
])

const assistantMessage = {
  id: "message-assistant",
  sessionID: "session-child",
  parentID: "message-0001",
  agent: "orchestrator",
  role: "assistant",
  mode: "orchestrator",
  modelID: "gpt-5.4",
  providerID: "openai",
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  time: {
    created: Date.now(),
  },
} as any

const streamEvents = [
  { type: "start" },
  { type: "tool-input-start", id: "call-1", toolName: "finish_task" },
  { type: "tool-call", toolCallId: "call-1", toolName: "finish_task", input: { summary: "done" } },
  {
    type: "tool-result",
    toolCallId: "call-1",
    input: { summary: "done" },
    output: {
      title: "done",
      output: "done",
      metadata: { summary: "done", status: "completed" },
    },
  },
  { type: "finish" },
]

function createFullStream() {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of streamEvents) {
        yield event
      }
    },
  }
}

function createStream(events: any[], error?: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
      if (error) throw error
    },
  }
}

function createParentMessages() {
  return [
    {
      info: {
        id: "message-0001",
        role: "user",
      },
      parts: [],
    },
    {
      info: {
        id: "message-0002",
        role: "assistant",
        finish: "tool-calls",
      },
      parts: [
        {
          id: "part-task",
          sessionID: "session-parent",
          messageID: "message-0002",
          type: "tool",
          tool: "task",
          callID: "call-task",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "task done",
            time: {
              start: Date.now(),
              end: Date.now(),
            },
          },
        },
      ],
    },
  ]
}

describe("session.processor legacy finish_task behavior", () => {
  beforeEach(async () => {
    await restoreModuleMocks()
  })

  afterEach(async () => {
    await restoreModuleMocks()
  })

  test("does not inspect or wake the parent after old finish_task results", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const getSession = mock(() => Promise.resolve({ id: "session-child", parentID: "session-parent" }))
    const getMessages = mock(() => Promise.resolve(createParentMessages()))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(LLM_PATH, () => ({
      LLM: {
        stream: mock(() => Promise.resolve({ fullStream: createFullStream() })),
      },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        parts: mock(() => Promise.resolve([])),
        fromError: mock(() => ({ name: "UnknownError" })),
      },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: getSession,
        messages: getMessages,
        updateMessage,
        updatePart,
        getUsage: mock(() => ({
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })),
        Event: { Error: "session.error" },
      },
    }))

    mock.module(STATUS_PATH, () => ({
      SessionStatus: {
        get: mock(() => ({ type: "idle" })),
        set: mock(() => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage: structuredClone(assistantMessage),
          sessionID: "session-child",
          model: { id: "gpt-5.4", modelID: "gpt-5.4", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("continue")
        expect(getMessages).not.toHaveBeenCalled()
      },
    })
  })
})

describe("session.processor finish-step usage aggregation", () => {
  beforeEach(async () => {
    await restoreModuleMocks()
  })

  afterEach(async () => {
    await restoreModuleMocks()
  })

  test("sums three finish-step token buckets and cost on one assistant message", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const usage = [
      { cost: 0.1, tokens: { input: 10, output: 1, reasoning: 2, cache: { read: 3, write: 4 } } },
      { cost: 0.2, tokens: { input: 20, output: 2, reasoning: 3, cache: { read: 4, write: 5 } } },
      { cost: 0.3, tokens: { input: 30, output: 3, reasoning: 4, cache: { read: 5, write: 6 } } },
    ]
    let usageIndex = 0

    mock.module(BUS_PATH, () => ({ Bus: { publish: mock(() => {}) } }))
    mock.module(CONFIG_PATH, () => ({ Config: { get: mock(() => Promise.resolve({})) } }))
    mock.module(LLM_PATH, () => ({
      LLM: {
        stream: mock(() =>
          Promise.resolve({
            fullStream: createStream([
              { type: "start" },
              { type: "finish-step", finishReason: "tool-calls", usage: { step: 1 } },
              { type: "finish-step", finishReason: "tool-calls", usage: { step: 2 } },
              { type: "finish-step", finishReason: "stop", usage: { step: 3 } },
              { type: "finish" },
            ]),
          }),
        ),
      },
    }))
    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        APIError: { isInstance: mock(() => false) },
        parts: mock(() => Promise.resolve([])),
        fromError: mock(() => ({ name: "UnknownError" })),
      },
    }))
    mock.module(SESSION_PATH, () => ({
      Session: {
        updateMessage,
        updatePart,
        getUsage: mock(() => usage[usageIndex++]),
        Event: { Error: "session.error" },
      },
    }))
    mock.module(COMPACTION_PATH, () => ({
      SessionCompaction: { isOverflow: mock(() => Promise.resolve(false)) },
    }))
    mock.module(SUMMARY_PATH, () => ({
      SessionSummary: { summarize: mock(() => {}) },
    }))
    mock.module(SNAPSHOT_PATH, () => ({
      Snapshot: {
        track: mock(() => Promise.resolve("snapshot-test")),
        patch: mock(() => Promise.resolve({ hash: "patch-test", files: [] })),
      },
    }))
    mock.module(STATUS_PATH, () => ({ SessionStatus: { get: mock(() => ({ type: "busy" })), set: mock(() => {}) } }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage: structuredClone(assistantMessage),
          sessionID: "session-child",
          model: { id: "gpt-5.5-fast", modelID: "gpt-5.5-fast", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("continue")
        expect(processor.message.cost).toBeCloseTo(0.6)
        expect(processor.message.tokens).toEqual({ input: 60, output: 6, reasoning: 9, cache: { read: 12, write: 15 } })
        expect(updatePart).toHaveBeenCalledWith(expect.objectContaining({ type: "step-finish", tokens: usage[0].tokens }))
        expect(updatePart).toHaveBeenCalledWith(expect.objectContaining({ type: "step-finish", tokens: usage[1].tokens }))
        expect(updatePart).toHaveBeenCalledWith(expect.objectContaining({ type: "step-finish", tokens: usage[2].tokens }))
      },
    })
  })
})

describe("session.processor OpenAI transport retry", () => {
  beforeEach(async () => {
    await restoreModuleMocks()
  })

  afterEach(async () => {
    await restoreModuleMocks()
  })

  test("retries TypeError terminated before assistant output and succeeds", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const removePart = mock(() => Promise.resolve("part-removed"))
    const setStatus = mock(() => {})
    const streamError = {
      name: "UnknownError",
      data: {
        message: "TypeError: terminated",
        name: "TypeError",
        cause: { name: "SocketError", message: "other side closed", code: "UND_ERR_SOCKET" },
      },
    } as const
    let streamCalls = 0
    const stream = mock(() => {
      const call = streamCalls++
      return Promise.resolve({
        fullStream:
          call === 0
            ? createStream([
                { type: "start" },
                { type: "reasoning-start", id: "reasoning-1", providerMetadata: { openai: { encrypted: "x" } } },
              ], new TypeError("terminated"))
            : createStream([{ type: "start" }, { type: "finish" }]),
      })
    })

    mock.module(BUS_PATH, () => ({
      Bus: {
        publish: mock(() => {}),
      },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(LLM_PATH, () => ({
      LLM: { stream },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        APIError: { isInstance: mock(() => false) },
        parts: mock(() => Promise.resolve([])),
        fromError: mock(() => streamError),
      },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        updateMessage,
        updatePart,
        removePart,
        getUsage: mock(() => ({
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })),
        Event: { Error: "session.error" },
      },
    }))

    mock.module(STATUS_PATH, () => ({
      SessionStatus: {
        get: mock(() => ({ type: "busy" })),
        set: setStatus,
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage: structuredClone(assistantMessage),
          sessionID: "session-child",
          model: { id: "gpt-5.5-fast", modelID: "gpt-5.5-fast", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("continue")
        expect(stream).toHaveBeenCalledTimes(2)
        expect(removePart).toHaveBeenCalledTimes(1)
        expect(setStatus).toHaveBeenCalledWith(
          "session-child",
          expect.objectContaining({ type: "retry", attempt: 1, message: "TypeError: terminated" }),
        )
        expect(processor.message.error).toBeUndefined()
      },
    })
  })

  test("does not retry TypeError terminated after assistant text output", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const removePart = mock(() => Promise.resolve("part-removed"))
    const publish = mock(() => {})
    const streamError = {
      name: "UnknownError",
      data: {
        message: "TypeError: terminated",
        name: "TypeError",
        cause: { name: "SocketError", message: "other side closed", code: "UND_ERR_SOCKET" },
      },
    } as const
    const stream = mock(() =>
      Promise.resolve({
        fullStream: createStream(
          [
            { type: "start" },
            { type: "text-start" },
            { type: "text-delta", text: "hello" },
          ],
          new TypeError("terminated"),
        ),
      }),
    )

    mock.module(BUS_PATH, () => ({
      Bus: { publish },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(LLM_PATH, () => ({
      LLM: { stream },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        APIError: { isInstance: mock(() => false) },
        parts: mock(() => Promise.resolve([])),
        fromError: mock(() => streamError),
      },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        updateMessage,
        updatePart,
        removePart,
        getUsage: mock(() => ({
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })),
        Event: { Error: "session.error" },
      },
    }))

    mock.module(STATUS_PATH, () => ({
      SessionStatus: {
        get: mock(() => ({ type: "busy" })),
        set: mock(() => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage: structuredClone(assistantMessage),
          sessionID: "session-child",
          model: { id: "gpt-5.5-fast", modelID: "gpt-5.5-fast", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("stop")
        expect(stream).toHaveBeenCalledTimes(1)
        expect(removePart).not.toHaveBeenCalled()
        expect(publish).toHaveBeenCalledWith("session.error", {
          sessionID: "session-child",
          error: streamError,
        })
        expect(processor.message.error).toEqual(streamError)
      },
    })
  })

  test("does not retry after text completion plugin can emit output", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const removePart = mock(() => Promise.resolve("part-removed"))
    const trigger = mock(() => Promise.resolve({ text: "plugin text" }))
    const streamError = { name: "UnknownError", data: { message: "TypeError: terminated" } } as const
    const stream = mock(() =>
      Promise.resolve({
        fullStream: createStream(
          [{ type: "start" }, { type: "text-start" }, { type: "text-end" }],
          new TypeError("terminated"),
        ),
      }),
    )

    mock.module(BUS_PATH, () => ({
      Bus: { publish: mock(() => {}) },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(LLM_PATH, () => ({
      LLM: { stream },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        APIError: { isInstance: mock(() => false) },
        parts: mock(() => Promise.resolve([])),
        fromError: mock(() => streamError),
      },
    }))

    mock.module(PLUGIN_PATH, () => ({
      Plugin: { trigger },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        updateMessage,
        updatePart,
        removePart,
        getUsage: mock(() => ({
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })),
        Event: { Error: "session.error" },
      },
    }))

    mock.module(STATUS_PATH, () => ({
      SessionStatus: {
        get: mock(() => ({ type: "busy" })),
        set: mock(() => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage: structuredClone(assistantMessage),
          sessionID: "session-child",
          model: { id: "gpt-5.5-fast", modelID: "gpt-5.5-fast", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("stop")
        expect(stream).toHaveBeenCalledTimes(1)
        expect(trigger).toHaveBeenCalledWith(
          "experimental.text.complete",
          expect.objectContaining({ sessionID: "session-child", messageID: "message-assistant" }),
          { text: "" },
        )
        expect(removePart).not.toHaveBeenCalled()
        expect(processor.message.error).toEqual(streamError)
      },
    })
  })
})
