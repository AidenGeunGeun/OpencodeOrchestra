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

  test("does not rerender webview pins for note-only edits", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain('let renderedPins = ""')
    expect(source).toContain("if (serialized === renderedPins) return")
    expect(source).toContain("`${comment.id}:${comment.point.x}:${comment.point.y}`")
    expect(source).not.toContain("${comment.note}")
  })

  test("invalidates rendered pins while the webview document is loading", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain("const invalidateRenderedPins = () =>")
    expect(source).toContain('setStore({ error: "", loading: true, ready: false, currentUrl: next, console: [] })')
    expect(source).toContain("setStore({ loading: true, ready: false })")
    expect(source).toContain("setStore({ loading: false, ready: true })")
  })
})
