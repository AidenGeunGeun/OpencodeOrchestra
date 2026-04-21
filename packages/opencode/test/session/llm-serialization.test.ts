import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII="
const USER_UPLOAD_DATA_URL = "data:image/png;base64,Zm9v"

function createModel(options?: { imageInput?: boolean }) {
  return {
    id: "gpt-5.4",
    providerID: "openai",
    capabilities: {
      input: {
        image: options?.imageInput ?? true,
      },
    },
  } as any
}

function createHistory(options?: {
  compacted?: boolean
  includeUserUpload?: boolean
  withAttachment?: boolean
}) {
  const output = JSON.stringify({ result: PNG_BASE64 })
  const savedPath = "/tmp/project/.oco/generated/session-test/call-image.png"

  const history: MessageV2.WithParts[] = [
    {
      info: {
        id: "message-user",
        sessionID: "session-test",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
      parts: [
        {
          id: "part-user-text",
          sessionID: "session-test",
          messageID: "message-user",
          type: "text",
          text: "Describe what happened.",
        },
        ...(options?.includeUserUpload
          ? [
              {
                id: "part-user-file",
                sessionID: "session-test",
                messageID: "message-user",
                type: "file" as const,
                mime: "image/png",
                filename: "upload.png",
                url: USER_UPLOAD_DATA_URL,
              },
            ]
          : []),
      ],
    },
    {
      info: {
        id: "message-assistant",
        sessionID: "session-test",
        parentID: "message-user",
        role: "assistant",
        time: { created: 2 },
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp/project", root: "/tmp/project" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: "gpt-5.4",
        providerID: "openai",
      },
      parts: [
        {
          id: "part-tool",
          sessionID: "session-test",
          messageID: "message-assistant",
          type: "tool",
          callID: "call-image",
          tool: "image_generation",
          state: {
            status: "completed",
            input: {},
            output,
            title: "Image generation",
            metadata: {},
            time: options?.compacted ? { start: 3, end: 4, compacted: 5 } : { start: 3, end: 4 },
            attachments: options?.withAttachment === false
              ? []
              : [
                  {
                    id: "part-file",
                    sessionID: "session-test",
                    messageID: "message-assistant",
                    type: "file",
                    mime: "image/png",
                    url: `file://${savedPath}`,
                  },
                ],
          },
        },
      ],
    },
  ]

  return {
    history,
    output,
    savedPath,
  }
}

function getSerializedToolResult(modelMessages: any[]) {
  const toolMessage = modelMessages.find((message) => message.role === "tool")
  expect(toolMessage).toBeDefined()
  expect(Array.isArray(toolMessage?.content)).toBe(true)
  return (toolMessage?.content as any[])[0]
}

describe("session.llm request serialization", () => {
  test("keeps persisted image-generation base64 on-wire for image-capable models", async () => {
    const { history, output } = createHistory()

    const modelMessages = await LLM.toRequestMessages(history, createModel({ imageInput: true }))

    const toolResult = getSerializedToolResult(modelMessages)
    expect(toolResult.output).toEqual({
      type: "text",
      value: output,
    })
    expect(JSON.stringify(modelMessages)).toContain(PNG_BASE64)

    const originalTool = history[1].parts[0]
    expect(originalTool.type).toBe("tool")
    if (originalTool.type === "tool" && originalTool.state.status === "completed") {
      expect(originalTool.state.output).toBe(output)
    }
  })

  test("replaces persisted image-generation base64 with a saved-file reference for text-only models", async () => {
    const { history, output, savedPath } = createHistory()

    const modelMessages = await LLM.toRequestMessages(history, createModel({ imageInput: false }))

    const toolResult = getSerializedToolResult(modelMessages)
    expect(toolResult.output).toEqual({
      type: "text",
      value: `{"result":"<see attached file: ${savedPath}>"}`,
    })
    expect(JSON.stringify(modelMessages)).not.toContain(PNG_BASE64)

    const originalTool = history[1].parts[0]
    expect(originalTool.type).toBe("tool")
    if (originalTool.type === "tool" && originalTool.state.status === "completed") {
      expect(originalTool.state.output).toBe(output)
    }
  })

  test("stripMedia forces the saved-file reference even on image-capable models", async () => {
    const { history, savedPath } = createHistory({ includeUserUpload: true })

    const modelMessages = await LLM.toRequestMessages(history, createModel({ imageInput: true }), {
      stripMedia: true,
    })

    expect(modelMessages[0]).toStrictEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe what happened." },
        { type: "text", text: "[Attached image/png: upload.png]" },
      ],
    })

    const serialized = JSON.stringify(modelMessages)
    expect(serialized).toContain(`<see attached file: ${savedPath}>`)
    expect(serialized).not.toContain(PNG_BASE64)
    expect(serialized).not.toContain(USER_UPLOAD_DATA_URL)
  })

  test("leaves compacted image-generation outputs untouched on both capability paths", async () => {
    const { history, savedPath } = createHistory({ compacted: true })

    const imageCapableMessages = await LLM.toRequestMessages(history, createModel({ imageInput: true }))
    const textOnlyMessages = await LLM.toRequestMessages(history, createModel({ imageInput: false }))

    expect(getSerializedToolResult(imageCapableMessages).output).toEqual(getSerializedToolResult(textOnlyMessages).output)

    const serialized = JSON.stringify(textOnlyMessages)
    expect(serialized).not.toContain(`<see attached file: ${savedPath}>`)
  })

  test("leaves attachment-less image-generation outputs untouched on both capability paths", async () => {
    const { history, output } = createHistory({ withAttachment: false })

    const imageCapableMessages = await LLM.toRequestMessages(history, createModel({ imageInput: true }))
    const textOnlyMessages = await LLM.toRequestMessages(history, createModel({ imageInput: false }))

    expect(getSerializedToolResult(imageCapableMessages).output).toEqual({
      type: "text",
      value: output,
    })
    expect(getSerializedToolResult(textOnlyMessages).output).toEqual({
      type: "text",
      value: output,
    })
    expect(JSON.stringify(textOnlyMessages)).toContain(PNG_BASE64)
  })
})
