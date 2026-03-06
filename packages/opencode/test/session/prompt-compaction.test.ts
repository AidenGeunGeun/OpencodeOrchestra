import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

const sessionID = "session"

function model(): Provider.Model {
  return {
    id: "test-model",
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
      input: { text: true, image: true, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai", id: "test-model" },
    options: {},
  } as Provider.Model
}

function user(messageID: string): MessageV2.User {
  return {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "test", modelID: "test-model" },
    tools: {},
    mode: "build",
  } as MessageV2.User
}

describe("session compaction message conversion", () => {
  test("strips media attachments into replay-safe placeholders", async () => {
    const input: MessageV2.WithParts[] = [
      {
        info: user("message-1"),
        parts: [
          {
            id: "part-1",
            sessionID,
            messageID: "message-1",
            type: "text",
            text: "please inspect the attachment",
          },
          {
            id: "part-2",
            sessionID,
            messageID: "message-1",
            type: "file",
            mime: "image/png",
            filename: "diagram.png",
            url: "data:image/png;base64,Zm9v",
          },
        ],
      },
    ]

    const result = await (MessageV2.toModelMessages as any)(input, model(), { stripMedia: true })

    expect(result).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "please inspect the attachment" },
          { type: "text", text: "[Attached image/png: diagram.png]" },
        ],
      },
    ])
  })
})
