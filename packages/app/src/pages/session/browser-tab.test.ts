import { describe, expect, test } from "bun:test"

describe("BrowserTab note editing", () => {
  test("renders queued comment cards with stable indexed DOM nodes and protected note focus", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain("<Index each={comments()}>")
    expect(source).toContain("value={comment().note}")
    expect(source).toContain("onInput={(event) => updateCommentNote(comment().id, event)}")
    expect(source).toContain("onKeyDown={(event) => event.stopPropagation()}")
    expect(source).toContain("data-prevent-autofocus")
    expect(source).toContain("next.focus({ preventScroll: true })")
  })
})
