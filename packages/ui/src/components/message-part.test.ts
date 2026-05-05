import { describe, expect, test } from "bun:test"

describe("MessagePart task rendering guards", () => {
  test("keeps stale part references and missing task metadata guarded", async () => {
    const source = await Bun.file(new URL("./message-part.tsx", import.meta.url)).text()

    expect(source).toContain("function taskChildSessionId(metadata: Record<string, any> | undefined)")
    expect(source).toContain('typeof value === "string" && value')
    expect(source).toContain("part={currentItem()}")
    expect(source).toContain("defaultOpen={partDefaultOpen(currentItem(), props.shellToolDefaultOpen, props.editToolDefaultOpen)}")
    expect(source).not.toContain("partDefaultOpen(item()!")
    expect(source).not.toContain("part={item()!}")
  })
})
