import { describe, expect, test } from "bun:test"
import type { FilePart, ToolPart } from "@opencode-ai/sdk/v2/client"
import { displayAttachmentPath, generatedImageMissingText, generatedToolImageAttachments } from "./generated-tool-attachments"

const fileAttachment = (input?: Partial<FilePart>) =>
  ({
    id: "file_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "file",
    mime: "image/png",
    filename: "generated image.png",
    url: "file:///tmp/generated%20image.png",
    ...input,
  }) as FilePart

const toolPart = (input?: Partial<ToolPart>): ToolPart =>
  ({
    id: "tool_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "image_generation",
    state: {
      status: "completed",
      input: {},
      output: "saved",
      title: "Generated image",
      metadata: {},
      time: { start: 1, end: 2 },
      attachments: [fileAttachment(), fileAttachment({ id: "file_2", mime: "text/plain" })],
    },
    ...input,
  }) as ToolPart

describe("generated tool attachments", () => {
  test("returns only image attachments for completed image generation tools", () => {
    const result = generatedToolImageAttachments(toolPart(), true)

    expect(result).toHaveLength(1)
    expect(result[0]?.mime).toBe("image/png")
  })

  test("skips attachments when desktop rendering is disabled or the tool is not completed image_generation", () => {
    expect(generatedToolImageAttachments(toolPart(), false)).toHaveLength(0)
    expect(generatedToolImageAttachments(toolPart({ tool: "bash" }), true)).toHaveLength(0)
    expect(
      generatedToolImageAttachments(
        toolPart({
          state: {
            status: "running",
            input: {},
            metadata: {},
            time: { start: 1 },
          },
        }),
        true,
      ),
    ).toHaveLength(0)
  })

  test("formats missing-image placeholders with readable file paths", () => {
    expect(displayAttachmentPath("file:///tmp/missing%20image.png")).toBe("/tmp/missing image.png")
    expect(displayAttachmentPath("file:///C:/Users/Aiden/My%20Image.png")).toBe("C:/Users/Aiden/My Image.png")
    expect(generatedImageMissingText(fileAttachment({ url: "file:///tmp/missing%20image.png" }))).toBe(
      "Generated image not found: /tmp/missing image.png",
    )
  })
})
