import { beforeEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const CONFIG_PATH = path.join(SRC_ROOT, "config/config.ts")
const LLM_PATH = path.join(SRC_ROOT, "session/llm.ts")
const MESSAGE_V2_PATH = path.join(SRC_ROOT, "session/message-v2.ts")
const PROMPT_PATH = path.join(SRC_ROOT, "session/prompt.ts")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const STATUS_PATH = path.join(SRC_ROOT, "session/status.ts")

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

describe("session.processor finish_task continuation", () => {
  beforeEach(() => {
    mock.restore()
  })

  test("restarts idle parent prompt loop after finish_task", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const getSession = mock(() => Promise.resolve({ id: "session-child", parentID: "session-parent" }))
    const getMessages = mock(() => Promise.resolve(createParentMessages()))
    const loop = mock(() => Promise.resolve(undefined))

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

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        loop,
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
        expect(getMessages).toHaveBeenCalledWith({ sessionID: "session-parent" })
        expect(loop).toHaveBeenCalledWith("session-parent")
      },
    })
  })

  test("keeps happy path unchanged when parent is already busy", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))
    const getMessages = mock(() => Promise.resolve(createParentMessages()))
    const loop = mock(() => Promise.resolve(undefined))

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

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        loop,
      },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock(() => Promise.resolve({ id: "session-child", parentID: "session-parent" })),
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
          model: { id: "gpt-5.4", modelID: "gpt-5.4", providerID: "openai" } as any,
          abort: new AbortController().signal,
        })

        const result = await processor.process({} as any)

        expect(result).toBe("continue")
        expect(getMessages).not.toHaveBeenCalled()
        expect(loop).not.toHaveBeenCalled()
      },
    })
  })

  test("logs and returns normally when continuation trigger fails", async () => {
    const updatePart = mock((part) => Promise.resolve("part" in part ? part.part : part))
    const updateMessage = mock((message) => Promise.resolve(message))

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

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        loop: mock(() => Promise.resolve(undefined)),
      },
    }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock(() => Promise.resolve({ id: "session-child", parentID: "session-parent" })),
        messages: mock(() => Promise.reject(new Error("repair failed"))),
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

        await expect(processor.process({} as any)).resolves.toBe("continue")
      },
    })
  })
})
