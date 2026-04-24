import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { TaskTool } from "../../src/tool/task"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createModuleMockRestorer } from "../fixture/module-mock"
import path from "path"

// Use absolute paths for mocks to ensure Bun intercepts them correctly in monorepo
const SRC_ROOT = path.resolve(__dirname, "../../src")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const MESSAGE_V2_PATH = path.join(SRC_ROOT, "session/message-v2.ts")
const PROMPT_PATH = path.join(SRC_ROOT, "session/prompt.ts")
const AGENT_PATH = path.join(SRC_ROOT, "agent/agent.ts")
const CONFIG_PATH = path.join(SRC_ROOT, "config/config.ts")
const BUS_PATH = path.join(SRC_ROOT, "bus/index.ts")
const restoreModuleMocks = await createModuleMockRestorer([
  SESSION_PATH,
  MESSAGE_V2_PATH,
  PROMPT_PATH,
  AGENT_PATH,
  CONFIG_PATH,
  BUS_PATH,
])

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
  beforeEach(async () => {
    await restoreModuleMocks()
  })

  afterEach(async () => {
    await restoreModuleMocks()
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

  test("adds todo denies when subagent does not explicitly allow todo access", async () => {
    const createSession = mock(() => Promise.resolve({ id: "depth2" }))
    const prompt = mock(() => Promise.resolve({ parts: [{ type: "text", text: "Subagent done" }] }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock((id) => {
          if (id === "test-session") return Promise.resolve({ id: "test-session", parentID: undefined })
          return Promise.resolve(undefined)
        }),
        create: createSession,
        messages: mock(() => Promise.resolve([])),
      },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        get: mock(() => Promise.resolve({ info: { role: "assistant", modelID: "gpt-4", providerID: "openai" } })),
        Event: { PartUpdated: "PartUpdated" },
      },
    }))

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        resolvePromptParts: mock(() => []),
        prompt,
        cancel: mock(),
      },
    }))

    mock.module(AGENT_PATH, () => ({
      Agent: {
        list: mock(() => Promise.resolve([])),
        get: mock(() =>
          Promise.resolve({
            name: "subagent",
            permission: [
              { permission: "todowrite", pattern: "*", action: "deny" },
              { permission: "todoread", pattern: "*", action: "deny" },
            ],
            singleShot: true,
          }),
        ),
      },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(BUS_PATH, () => ({
      GlobalBus: {
        emit: mock(() => {}),
        on: mock(() => {}),
        off: mock(() => {}),
      },
      Bus: {
        subscribe: mock(() => () => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await TaskTool.init()
        await impl.execute(
          {
            description: "Subtask",
            prompt: "Do work",
            subagent_type: "subagent",
          },
          ctx,
        )

        expect(createSession).toHaveBeenCalledTimes(1)
        const sessionInput = (createSession.mock.calls.at(0) as any)?.[0]
        expect(sessionInput.permission).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ permission: "todowrite", action: "deny" }),
            expect.objectContaining({ permission: "todoread", action: "deny" }),
          ]),
        )

        expect(prompt).toHaveBeenCalledTimes(1)
        const promptInput = (prompt.mock.calls.at(0) as any)?.[0]
        expect(promptInput.tools).toMatchObject({
          todowrite: false,
          todoread: false,
          task: false,
        })
      },
    })
  })

  test("omits todo denies when subagent explicitly allows todo access", async () => {
    const createSession = mock(() => Promise.resolve({ id: "depth2" }))
    const prompt = mock(() => Promise.resolve({ parts: [{ type: "text", text: "Subagent done" }] }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock((id) => {
          if (id === "test-session") return Promise.resolve({ id: "test-session", parentID: undefined })
          return Promise.resolve(undefined)
        }),
        create: createSession,
        messages: mock(() => Promise.resolve([])),
      },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        get: mock(() => Promise.resolve({ info: { role: "assistant", modelID: "gpt-4", providerID: "openai" } })),
        Event: { PartUpdated: "PartUpdated" },
      },
    }))

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        resolvePromptParts: mock(() => []),
        prompt,
        cancel: mock(),
      },
    }))

    mock.module(AGENT_PATH, () => ({
      Agent: {
        list: mock(() => Promise.resolve([])),
        get: mock(() =>
          Promise.resolve({
            name: "subagent",
            permission: [
              { permission: "todowrite", pattern: "*", action: "allow" },
              { permission: "todoread", pattern: "*", action: "allow" },
            ],
            singleShot: true,
          }),
        ),
      },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(BUS_PATH, () => ({
      GlobalBus: {
        emit: mock(() => {}),
        on: mock(() => {}),
        off: mock(() => {}),
      },
      Bus: {
        subscribe: mock(() => () => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await TaskTool.init()
        await impl.execute(
          {
            description: "Subtask",
            prompt: "Do work",
            subagent_type: "subagent",
          },
          ctx,
        )

        expect(createSession).toHaveBeenCalledTimes(1)
        const sessionInput = (createSession.mock.calls.at(0) as any)?.[0]
        expect(sessionInput.permission).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ permission: "todowrite", action: "deny" }),
            expect.objectContaining({ permission: "todoread", action: "deny" }),
          ]),
        )

        expect(prompt).toHaveBeenCalledTimes(1)
        const promptInput = (prompt.mock.calls.at(0) as any)?.[0]
        expect(promptInput.tools).not.toHaveProperty("todowrite")
        expect(promptInput.tools).not.toHaveProperty("todoread")
        expect(promptInput.tools).toHaveProperty("task", false)
      },
    })
  })

  test("passes loaded design context into design-facing subagent handoffs", async () => {
    const prompt = mock(() => Promise.resolve({ parts: [{ type: "text", text: "Subagent done" }] }))

    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock((id) => {
          if (id === "test-session") return Promise.resolve({ id: "test-session", parentID: undefined })
          return Promise.resolve(undefined)
        }),
        create: mock(() => Promise.resolve({ id: "depth2" })),
        messages: mock(() => Promise.resolve([])),
      },
    }))

    mock.module(MESSAGE_V2_PATH, () => ({
      MessageV2: {
        get: mock(() => Promise.resolve({ info: { role: "assistant", modelID: "gpt-4", providerID: "openai" } })),
        Event: { PartUpdated: "PartUpdated" },
      },
    }))

    mock.module(PROMPT_PATH, () => ({
      SessionPrompt: {
        resolvePromptParts: mock((text) => [{ type: "text", text }]),
        prompt,
        cancel: mock(),
      },
    }))

    mock.module(AGENT_PATH, () => ({
      Agent: {
        list: mock(() => Promise.resolve([])),
        get: mock(() =>
          Promise.resolve({
            name: "subagent",
            permission: [],
            singleShot: true,
          }),
        ),
      },
    }))

    mock.module(CONFIG_PATH, () => ({
      Config: {
        get: mock(() => Promise.resolve({})),
      },
    }))

    mock.module(BUS_PATH, () => ({
      GlobalBus: {
        emit: mock(() => {}),
        on: mock(() => {}),
        off: mock(() => {}),
      },
      Bus: {
        subscribe: mock(() => () => {}),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await TaskTool.init()
        await impl.execute(
          {
            description: "Review UI",
            prompt: "Review the frontend layout",
            subagent_type: "subagent",
          },
          {
            ...ctx,
            messages: [
              {
                info: { role: "assistant" },
                parts: [
                  {
                    type: "tool",
                    tool: "design",
                    state: {
                      status: "completed",
                      output: "<design_context>Loaded design tokens</design_context>",
                      time: {},
                    },
                  },
                ],
              },
            ] as any,
          },
        )

        expect(prompt).toHaveBeenCalledTimes(1)
        const promptInput = (prompt.mock.calls.at(0) as any)?.[0]
        expect(promptInput.parts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("Loaded design tokens"),
            }),
          ]),
        )
      },
    })
  })
})
