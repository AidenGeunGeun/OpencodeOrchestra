import path from "path"
import { describe, expect, test } from "bun:test"
import { GeneratedImage } from "../../src/session/generated-image"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII="
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64")

describe("session.generated-image", () => {
  test("saves decoded bytes under a sanitized generated-image path", async () => {
    await using tmp = await tmpdir()
    const sessionID = "session/../\u0001id"
    const callID = "call/../\u0000id"

    const saved = await GeneratedImage.save({
      cwd: tmp.path,
      sessionID,
      callID,
      output: JSON.stringify({ result: PNG_BASE64 }),
    })

    expect(saved).toBeDefined()
    expect(saved?.path).toBe(
      path.join(
        tmp.path,
        ".oco",
        "generated",
        GeneratedImage.sanitizeSegment(sessionID),
        GeneratedImage.filename(callID),
      ),
    )
    expect(Buffer.from(await Bun.file(saved!.path).arrayBuffer())).toStrictEqual(PNG_BYTES)
  })

  test("rejects data URLs as malformed image-generation payloads", async () => {
    await using tmp = await tmpdir()
    const callID = "call-data-url-helper"

    const saved = await GeneratedImage.save({
      cwd: tmp.path,
      sessionID: "session-helper",
      callID,
      output: JSON.stringify({ result: `data:image/png;base64,${PNG_BASE64}` }),
    })

    expect(saved).toBeUndefined()
    const logs = await Bun.file(Log.file()).text()
    expect(logs).toContain("invalid image_generation payload")
    expect(logs).toContain(callID)
  })
})
