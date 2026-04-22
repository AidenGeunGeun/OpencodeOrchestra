import path from "path"
import { pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderNamespace } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII="
const USER_UPLOAD_DATA_URL = "data:image/png;base64,Zm9v"
const STOP_AFTER_TITLE = "STOP_AFTER_TITLE"

function createModel(id = "test-model", options?: { imageInput?: boolean }): Provider.Model {
  return {
    id,
    providerID: "test",
    name: "Test",
    limit: {
      context: 128_000,
      output: 8_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: true,
      reasoning: false,
      temperature: true,
      input: { text: true, image: options?.imageInput ?? true, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai", id },
    options: {},
  } as Provider.Model
}

function createHistory(root: string) {
  const sessionID = "session-test"
  const syntheticUserID = "message-synthetic"
  const assistantID = "message-assistant"
  const realUserID = "message-user"
  const savedPath = path.join(root, ".oco/generated/session-test/call-image.png")

  const history: MessageV2.WithParts[] = [
    {
      info: {
        id: syntheticUserID,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "test", modelID: "prompt-model" },
      },
      parts: [
        {
          id: "part-synthetic-text",
          sessionID,
          messageID: syntheticUserID,
          type: "text",
          text: "Synthetic setup",
          synthetic: true,
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        parentID: syntheticUserID,
        role: "assistant",
        time: { created: 2 },
        mode: "build",
        agent: "build",
        path: { cwd: root, root },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: "prompt-model",
        providerID: "test",
      },
      parts: [
        {
          id: "part-image-tool",
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: "call-image",
          tool: "image_generation",
          state: {
            status: "completed",
            input: {},
            output: JSON.stringify({ result: PNG_BASE64 }),
            title: "Image generation",
            metadata: {},
            time: { start: 3, end: 4 },
            attachments: [
              {
                id: "part-generated-file",
                sessionID,
                messageID: assistantID,
                type: "file",
                mime: "image/png",
                filename: "call-image.png",
                url: pathToFileURL(savedPath).href,
              },
            ],
          },
        },
      ],
    },
    {
      info: {
        id: realUserID,
        sessionID,
        role: "user",
        time: { created: 5 },
        agent: "build",
        model: { providerID: "test", modelID: "prompt-model" },
      },
      parts: [
        {
          id: "part-user-text",
          sessionID,
          messageID: realUserID,
          type: "text",
          text: "Please continue.",
        },
        {
          id: "part-user-file",
          sessionID,
          messageID: realUserID,
          type: "file",
          mime: "image/png",
          filename: "upload.png",
          url: USER_UPLOAD_DATA_URL,
        },
      ],
    },
  ]

  return {
    history,
    realUserID,
    sessionID,
    savedPath,
  }
}

describe("session outbound request paths", () => {
  test("compaction strips generated-image base64 and still strips user media", async () => {
    await using tmp = await tmpdir()
    const { history, realUserID, sessionID, savedPath } = createHistory(tmp.path)

    let capturedMessages: unknown[] = []
    const originalCreate = SessionProcessor.create
    const originalAgentGet = Agent.get
    const originalGetModel = ProviderNamespace.getModel
    const originalTrigger = Plugin.trigger
    const originalUpdateMessage = Session.updateMessage
    const originalPublish = Bus.publish

    ;(SessionProcessor as any).create = (input: any) => ({
      message: input.assistantMessage,
      process: async (streamInput: any) => {
        capturedMessages = streamInput.messages
        return "continue"
      },
    })
    ;(Agent as any).get = async () => ({
      name: "compaction",
      mode: "system",
      permission: [],
      options: {},
      model: { providerID: "test", modelID: "compact-model" },
    })
    ;(ProviderNamespace as any).getModel = async () => createModel("compact-model")
    ;(Plugin as any).trigger = async (_hook: string, _input: unknown, output: unknown) => output
    ;(Session as any).updateMessage = async (message: any) => message
    ;(Bus as any).publish = () => {}

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await SessionCompaction.process({
            messages: history,
            parentID: realUserID,
            sessionID,
            abort: new AbortController().signal,
            auto: false,
          })

          expect(result).toBe("continue")
        },
      })
    } finally {
      ;(SessionProcessor as any).create = originalCreate
      ;(Agent as any).get = originalAgentGet
      ;(ProviderNamespace as any).getModel = originalGetModel
      ;(Plugin as any).trigger = originalTrigger
      ;(Session as any).updateMessage = originalUpdateMessage
      ;(Bus as any).publish = originalPublish
    }

    const serialized = JSON.stringify(capturedMessages)
    expect(serialized).toContain(`<see attached file: ${savedPath}>`)
    expect(serialized).toContain("[Attached image/png: upload.png]")
    expect(serialized).not.toContain(PNG_BASE64)
    expect(serialized).not.toContain(USER_UPLOAD_DATA_URL)
  })

  test("title generation strips generated-image base64 even for image-capable models", async () => {
    await using tmp = await tmpdir()
    const { history, savedPath } = createHistory(tmp.path)

    let capturedMessages: unknown[] | undefined
    let resolveTitleCall: (() => void) | undefined
    const titleCall = new Promise<void>((resolve) => {
      resolveTitleCall = resolve
    })

    const originalStream = LLM.stream
    const originalAgentGet = Agent.get
    const originalGetModel = ProviderNamespace.getModel
    const originalFilterCompacted = MessageV2.filterCompacted
    const originalMessageStream = MessageV2.stream

    ;(LLM as any).stream = async (input: any) => {
      if (input.small === true) {
        capturedMessages = input.messages
        resolveTitleCall?.()
      }

      return {
        text: Promise.resolve("Generated title"),
        fullStream: {
          async *[Symbol.asyncIterator]() {},
        },
      }
    }
    ;(Agent as any).get = async (name: string) => {
      if (name === "title") {
        return {
          name: "title",
          mode: "title",
          permission: [],
          options: {},
          model: { providerID: "test", modelID: "title-model" },
        }
      }

      return undefined
    }
    ;(ProviderNamespace as any).getModel = async (_providerID: string, modelID: string) => {
      if (modelID === "title-model") return createModel("title-model", { imageInput: true })
      throw new Error(STOP_AFTER_TITLE)
    }
    ;(MessageV2 as any).filterCompacted = async () => history
    ;(MessageV2 as any).stream = () => history

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const loopPromise = SessionPrompt.loop(session.id).catch(() => undefined)

          await Promise.race([
            titleCall,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for title request")), 2000)),
          ])

          SessionPrompt.cancel(session.id)
          await Promise.race([loopPromise, new Promise((resolve) => setTimeout(resolve, 1000))])
        },
      })
    } finally {
      ;(LLM as any).stream = originalStream
      ;(Agent as any).get = originalAgentGet
      ;(ProviderNamespace as any).getModel = originalGetModel
      ;(MessageV2 as any).filterCompacted = originalFilterCompacted
      ;(MessageV2 as any).stream = originalMessageStream
    }

    const serialized = JSON.stringify(capturedMessages)
    expect(serialized).toContain(`<see attached file: ${savedPath}>`)
    expect(serialized).not.toContain(PNG_BASE64)
    expect(serialized).not.toContain(USER_UPLOAD_DATA_URL)
    expect(serialized).toContain("[Attached image/png: upload.png]")
  }, 15000)
})
