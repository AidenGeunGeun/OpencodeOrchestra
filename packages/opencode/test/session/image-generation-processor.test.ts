import fs from "fs/promises"
import path from "path"
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { Session } from "../../src/session"
import { GeneratedImage } from "../../src/session/generated-image"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII="
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64")

let streamEvents: any[] = []
const originalStream = LLM.stream

const stream = mock(() =>
  Promise.resolve({
    fullStream: {
      async *[Symbol.asyncIterator]() {
        for (const event of streamEvents) {
          yield event
        }
      },
    },
  }),
)

describe("session.processor image_generation persistence", () => {
  beforeEach(() => {
    stream.mockClear()
    streamEvents = []
  })

  test("persists generated images, attaches file parts, and injects reminders", async () => {
    await using tmp = await tmpdir({ git: true })

    await withMockedStream(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
        const ctx = await createSessionContext(tmp.path)
        const callID = "call-image-ok"
        streamEvents = createImageGenerationStream([
          { callID, output: JSON.stringify({ result: PNG_BASE64 }) },
        ])

        const processor = SessionProcessor.create({
          assistantMessage: ctx.assistant,
          sessionID: ctx.session.id,
          model: ctx.model,
          abort: new AbortController().signal,
        })

        const result = await processor.process({
          user: ctx.user,
          sessionID: ctx.session.id,
          model: ctx.model,
          agent: { name: "build", mode: "build", permission: [], options: {} } as any,
          system: [],
          abort: new AbortController().signal,
          messages: [],
          tools: {},
        } as any)

        expect(result).toBe("continue")

        const outputPath = GeneratedImage.resolvePath({
          cwd: tmp.path,
          sessionID: ctx.session.id,
          callID,
        }).outputPath
        expect(Buffer.from(await Bun.file(outputPath).arrayBuffer())).toStrictEqual(PNG_BYTES)

        const messages = await Session.messages({ sessionID: ctx.session.id })
        const assistant = messages.find((message) => message.info.id === ctx.assistant.id)
        const toolPart = assistant?.parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === callID,
        )
        expect(toolPart?.state.status).toBe("completed")
        expect(toolPart?.state.status === "completed" ? toolPart.state.attachments : undefined).toEqual([
          expect.objectContaining({
            type: "file",
            mime: "image/png",
            filename: GeneratedImage.filename(callID),
            url: `file://${outputPath}`,
          }),
        ])

        const user = messages.find((message) => message.info.id === ctx.user.id)
        const reminders = user?.parts.filter(
          (part): part is MessageV2.TextPart =>
            part.type === "text" && part.synthetic === true && part.text.includes("Generated images are saved to"),
        )
        expect(reminders).toHaveLength(1)
        expect(reminders?.[0]?.text).toContain(`.oco/generated/${GeneratedImage.sanitizeSegment(ctx.session.id)}/`)
        },
      })
    })
  }, 20000)

  test("handles two successive generations in one turn", async () => {
    await using tmp = await tmpdir({ git: true })

    await withMockedStream(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
        const ctx = await createSessionContext(tmp.path)
        const firstCallID = "call-first"
        const secondCallID = "call-second"
        streamEvents = createImageGenerationStream([
          { callID: firstCallID, output: JSON.stringify({ result: PNG_BASE64 }) },
          { callID: secondCallID, output: JSON.stringify({ result: PNG_BASE64 }) },
        ])

        const processor = SessionProcessor.create({
          assistantMessage: ctx.assistant,
          sessionID: ctx.session.id,
          model: ctx.model,
          abort: new AbortController().signal,
        })

        await processor.process({
          user: ctx.user,
          sessionID: ctx.session.id,
          model: ctx.model,
          agent: { name: "build", mode: "build", permission: [], options: {} } as any,
          system: [],
          abort: new AbortController().signal,
          messages: [],
          tools: {},
        } as any)

        const firstPath = GeneratedImage.resolvePath({
          cwd: tmp.path,
          sessionID: ctx.session.id,
          callID: firstCallID,
        }).outputPath
        const secondPath = GeneratedImage.resolvePath({
          cwd: tmp.path,
          sessionID: ctx.session.id,
          callID: secondCallID,
        }).outputPath
        expect(await Bun.file(firstPath).exists()).toBe(true)
        expect(await Bun.file(secondPath).exists()).toBe(true)

        const messages = await Session.messages({ sessionID: ctx.session.id })
        const assistant = messages.find((message) => message.info.id === ctx.assistant.id)
        const completedImageTools = assistant?.parts.filter(
          (part): part is MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted } =>
            part.type === "tool" && part.tool === "image_generation" && part.state.status === "completed",
        )
        expect(completedImageTools).toHaveLength(2)
        expect(completedImageTools?.every((part) => (part.state.attachments ?? []).length === 1)).toBe(true)

        const user = messages.find((message) => message.info.id === ctx.user.id)
        const reminders = user?.parts.filter(
          (part): part is MessageV2.TextPart =>
            part.type === "text" && part.synthetic === true && part.text.includes("Generated images are saved to"),
        )
        expect(reminders).toHaveLength(2)
        },
      })
    })
  }, 20000)

  test("falls back cleanly on malformed payloads", async () => {
    await using tmp = await tmpdir({ git: true })

    await withMockedStream(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
        const ctx = await createSessionContext(tmp.path)
        const callID = "call-invalid-base64"
        const badPayload = JSON.stringify({ result: "%%%not-base64%%%" })
        streamEvents = createImageGenerationStream([{ callID, output: badPayload }])

        const processor = SessionProcessor.create({
          assistantMessage: ctx.assistant,
          sessionID: ctx.session.id,
          model: ctx.model,
          abort: new AbortController().signal,
        })

        const result = await processor.process({
          user: ctx.user,
          sessionID: ctx.session.id,
          model: ctx.model,
          agent: { name: "build", mode: "build", permission: [], options: {} } as any,
          system: [],
          abort: new AbortController().signal,
          messages: [],
          tools: {},
        } as any)

        expect(result).toBe("continue")

        const outputPath = GeneratedImage.resolvePath({
          cwd: tmp.path,
          sessionID: ctx.session.id,
          callID,
        }).outputPath
        expect(await Bun.file(outputPath).exists()).toBe(false)

        const messages = await Session.messages({ sessionID: ctx.session.id })
        const assistant = messages.find((message) => message.info.id === ctx.assistant.id)
        const toolPart = assistant?.parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === callID,
        )
        expect(toolPart?.state.status).toBe("completed")
        expect(toolPart?.state.status === "completed" ? toolPart.state.attachments : undefined).toBeUndefined()
        expect(toolPart?.state.status === "completed" ? toolPart.state.output : undefined).toBe(badPayload)

        const user = messages.find((message) => message.info.id === ctx.user.id)
        const reminders = user?.parts.filter(
          (part): part is MessageV2.TextPart =>
            part.type === "text" && part.synthetic === true && part.text.includes("Generated images are saved to"),
        )
        expect(reminders).toHaveLength(0)

        const logs = await Bun.file(Log.file()).text()
        expect(logs).toContain("invalid image_generation payload")
        expect(logs).toContain(callID)
        },
      })
    })
  }, 20000)

  test("falls back cleanly when the generated-image directory cannot be written", async () => {
    await using tmp = await tmpdir({ git: true })

    await fs.mkdir(path.join(tmp.path, ".oco"), { recursive: true })
    await Bun.write(path.join(tmp.path, ".oco", "generated"), "occupied")

    await withMockedStream(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
        const ctx = await createSessionContext(tmp.path)
        const callID = "call-write-fail"
        const payload = JSON.stringify({ result: PNG_BASE64 })
        streamEvents = createImageGenerationStream([{ callID, output: payload }])

        const processor = SessionProcessor.create({
          assistantMessage: ctx.assistant,
          sessionID: ctx.session.id,
          model: ctx.model,
          abort: new AbortController().signal,
        })

        const result = await processor.process({
          user: ctx.user,
          sessionID: ctx.session.id,
          model: ctx.model,
          agent: { name: "build", mode: "build", permission: [], options: {} } as any,
          system: [],
          abort: new AbortController().signal,
          messages: [],
          tools: {},
        } as any)

        expect(result).toBe("continue")

        const messages = await Session.messages({ sessionID: ctx.session.id })
        const assistant = messages.find((message) => message.info.id === ctx.assistant.id)
        const toolPart = assistant?.parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.callID === callID,
        )
        expect(toolPart?.state.status).toBe("completed")
        expect(toolPart?.state.status === "completed" ? toolPart.state.attachments : undefined).toBeUndefined()
        expect(toolPart?.state.status === "completed" ? toolPart.state.output : undefined).toBe(payload)

        const user = messages.find((message) => message.info.id === ctx.user.id)
        const reminders = user?.parts.filter(
          (part): part is MessageV2.TextPart =>
            part.type === "text" && part.synthetic === true && part.text.includes("Generated images are saved to"),
        )
        expect(reminders).toHaveLength(0)

        const logs = await Bun.file(Log.file()).text()
        expect(logs).toContain("failed to save generated image")
        expect(logs).toContain(callID)
        },
      })
    })
  }, 20000)

  test("sanitizes unsafe call IDs before writing generated image paths", async () => {
    await using tmp = await tmpdir({ git: true })

    await withMockedStream(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
        const ctx = await createSessionContext(tmp.path)
        const callID = `bad/../${String.fromCharCode(1)}name`
        streamEvents = createImageGenerationStream([
          { callID, output: JSON.stringify({ result: PNG_BASE64 }) },
        ])

        const processor = SessionProcessor.create({
          assistantMessage: ctx.assistant,
          sessionID: ctx.session.id,
          model: ctx.model,
          abort: new AbortController().signal,
        })

        await processor.process({
          user: ctx.user,
          sessionID: ctx.session.id,
          model: ctx.model,
          agent: { name: "build", mode: "build", permission: [], options: {} } as any,
          system: [],
          abort: new AbortController().signal,
          messages: [],
          tools: {},
        } as any)

        const { outputPath, root } = GeneratedImage.resolvePath({
          cwd: tmp.path,
          sessionID: ctx.session.id,
          callID,
        })
        expect(outputPath).toContain(`${GeneratedImage.sanitizeSegment(callID)}.png`)
        expect(outputPath.startsWith(root + path.sep)).toBe(true)
        expect(await Bun.file(outputPath).exists()).toBe(true)
        },
      })
    })
  }, 20000)
})

async function withMockedStream<T>(fn: () => Promise<T>) {
  ;(LLM as any).stream = stream
  try {
    return await fn()
  } finally {
    ;(LLM as any).stream = originalStream
  }
}

async function createSessionContext(directory: string) {
  const session = await Session.create({})
  const user: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5.4" },
  }
  await Session.updateMessage(user)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: user.id,
    type: "text",
    text: "Generate an image.",
  })

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    sessionID: session.id,
    parentID: user.id,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: {
      cwd: directory,
      root: directory,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "gpt-5.4",
    providerID: "openai",
    time: { created: Date.now() },
  }
  await Session.updateMessage(assistant)

  const model = {
    id: "gpt-5.4",
    providerID: "openai",
  } as any

  return { session, user, assistant, model }
}

function createImageGenerationStream(items: Array<{ callID: string; output: string }>) {
  return [
    { type: "start" },
    ...items.flatMap((item) => [
      { type: "tool-input-start", id: item.callID, toolName: "image_generation" },
      { type: "tool-call", toolCallId: item.callID, toolName: "image_generation", input: {} },
      {
        type: "tool-result",
        toolCallId: item.callID,
        input: {},
        output: {
          title: "Image generation",
          output: item.output,
          metadata: {},
        },
      },
    ]),
    { type: "finish" },
  ]
}
