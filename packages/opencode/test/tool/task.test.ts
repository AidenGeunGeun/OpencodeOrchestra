import { describe, expect, test, mock, beforeEach } from "bun:test"
import { TaskTool } from "../../src/tool/task"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

// Use absolute paths for mocks to ensure Bun intercepts them correctly in monorepo
const SRC_ROOT = path.resolve(__dirname, "../../src")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const MESSAGE_V2_PATH = path.join(SRC_ROOT, "session/message-v2.ts")
const PROMPT_PATH = path.join(SRC_ROOT, "session/prompt.ts")
const AGENT_PATH = path.join(SRC_ROOT, "agent/agent.ts")
const CONFIG_PATH = path.join(SRC_ROOT, "config/config.ts")
const BUS_PATH = path.join(SRC_ROOT, "bus/index.ts")

const ctx = {
  sessionID: "test-session",
  messageID: "test-msg",
  callID: "",
  agent: "pm",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("tool.task", () => {
  beforeEach(() => {
    mock.restore()
  })

  test("subagent (depth 2+) is ALWAYS singleShot", async () => {
    // Setup depth 1 session (Orchestrator calling Subagent)
    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock((id) => {
          if (id === "depth1") return Promise.resolve({ id: "depth1", parentID: "root" })
          if (id === "root") return Promise.resolve({ id: "root", parentID: undefined })
          return Promise.resolve(undefined)
        }),
        create: mock(() => Promise.resolve({ id: "depth2" })),
        messages: mock(() => Promise.resolve([])),
      },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        get: mock(() => Promise.resolve({ info: { role: "assistant", modelID: "gpt-4", providerID: "openai" } })),
        Event: { PartUpdated: "PartUpdated" }
      },
    }))

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        resolvePromptParts: mock(() => []),
        prompt: mock(() => Promise.resolve({ parts: [{ type: "text", text: "Subagent done" }] })),
        cancel: mock(),
      }
    }))
    
    mock.module(AGENT_PATH, () => ({
      Agent: {
        list: mock(() => Promise.resolve([])),
        get: mock(() => Promise.resolve({ 
          name: "subagent", 
          permission: [],
          singleShot: false // Config says false, but depth 2 should force true
        })),
      }
    }))
    
    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      }
    }))

    mock.module(BUS_PATH, () => ({
      GlobalBus: {
        emit: mock(() => {}),
        on: mock(() => {}),
        off: mock(() => {}),
      },
      Bus: {
        subscribe: mock(() => () => {}), // Returns a function for unsubscription
      }
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testCtx = { ...ctx, sessionID: "depth1" }
        const impl = await TaskTool.init()
        const result = await impl.execute({
          description: "Subtask",
          prompt: "Do work",
          subagent_type: "subagent"
        }, testCtx)
        
        // If it was singleShot, it returns output directly from SessionPrompt.prompt
        expect(result.output).toContain("Subagent done")
        expect(result.metadata.sessionId).toBe("depth2")
      },
    })
  })
})
