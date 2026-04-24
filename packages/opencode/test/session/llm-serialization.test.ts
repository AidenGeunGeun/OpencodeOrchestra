import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"

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

function createHistory(options?: { includeUserUpload?: boolean }) {
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
  ]

  return { history }
}

describe("session.llm request serialization", () => {
  test("stripMedia replaces user-uploaded media with a text placeholder", async () => {
    const { history } = createHistory({ includeUserUpload: true })

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

    expect(JSON.stringify(modelMessages)).not.toContain(USER_UPLOAD_DATA_URL)
  })

  test("keeps user-uploaded media intact when stripMedia is not enabled", async () => {
    const { history } = createHistory({ includeUserUpload: true })

    const modelMessages = await LLM.toRequestMessages(history, createModel({ imageInput: true }))

    expect(modelMessages[0]?.role).toBe("user")
    expect(Array.isArray(modelMessages[0]?.content)).toBe(true)

    const content = modelMessages[0]?.content as any[]
    expect(content).toHaveLength(2)
    expect(content[0]).toStrictEqual({ type: "text", text: "Describe what happened." })
    expect(content[1]?.type).toBe("file")
    expect(content[1]?.filename).toBe("upload.png")
    expect(content[1]?.mediaType).toBe("image/png")
    expect(JSON.stringify(content[1])).toContain(USER_UPLOAD_DATA_URL)
  })
})
