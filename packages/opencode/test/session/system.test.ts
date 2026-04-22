import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"

describe("SystemPrompt.instructions", () => {
  test("includes Codex image-generation guidance with the required structure", () => {
    const instructions = SystemPrompt.instructions({ codexImageGeneration: true })

    expect(instructions).toContain(
      "The `image_generation` tool generates PNG images using OpenAI's image model.",
    )
    expect(instructions).toContain(".oco/generated/<session>/<call-id>.png")
    expect(instructions).toContain("**When to use it:**")
    expect(instructions).toContain("**When NOT to use it:**")
    expect(instructions).toContain("**Examples:**")
    expect(instructions).toContain("*Example 1")
    expect(instructions).toContain("*Example 2")
  })
})
