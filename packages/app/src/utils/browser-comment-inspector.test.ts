import { describe, expect, test } from "bun:test"
import { browserCommentInspectorScript, browserCommentMarker, createBrowserCommentInspectorScript } from "./browser-comment-inspector"

describe("browserCommentInspectorScript", () => {
  test("is valid JavaScript for webview injection", () => {
    expect(() => new Function(browserCommentInspectorScript)).not.toThrow()
  })

  test("uses an explicit active flag before capturing page interactions", () => {
    expect(browserCommentInspectorScript).toContain("window.__ocoBrowserCommentsActive")
    expect(browserCommentInspectorScript).toContain("if (!active()) { highlight.style.display = \"none\"; return; }")
    expect(browserCommentInspectorScript).toContain("if (!active() || event.shiftKey || drag || event.button !== 0) return;")
    expect(browserCommentInspectorScript).toContain("if (!active() || !event.shiftKey || event.button !== 0) return;")
    expect(browserCommentInspectorScript).toContain("if (!event.isTrusted) return;")
    expect(browserCommentInspectorScript).toContain('if (!event.isTrusted) return; event.preventDefault(); event.stopPropagation(); send("delete"')
  })

  test("exposes a selection-mode toggle and stable host bridge marker", () => {
    expect(browserCommentInspectorScript).toContain("setActive")
    expect(browserCommentInspectorScript).toContain(browserCommentMarker)
    expect(browserCommentInspectorScript).toContain("console.log(marker + JSON.stringify")
    expect(browserCommentInspectorScript).toContain("nonce")
  })

  test("embeds a per-host nonce in bridge messages", () => {
    const script = createBrowserCommentInspectorScript("nonce-fixture")

    expect(script).toContain('const nonce = "nonce-fixture"')
    expect(script).toContain("{ type, payload, nonce }")
  })
})
