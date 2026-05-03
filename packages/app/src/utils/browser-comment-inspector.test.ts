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

  test("separates viewport screenshot rectangles from page-stable pin anchors", () => {
    expect(browserCommentInspectorScript).toContain("const rectData = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })")
    expect(browserCommentInspectorScript).toContain("const pagePoint = (point) => ({ x: point.x + window.scrollX, y: point.y + window.scrollY, coordinateSpace: \"page\" })")
    expect(browserCommentInspectorScript).toContain("send(\"selection\", { kind: \"element\", rect: rectData(rect), point, anchor: pagePoint(point)")
    expect(browserCommentInspectorScript).toContain("send(\"selection\", { kind: \"area\", rect, point, anchor: pagePoint(point) })")
  })

  test("renders page-coordinate pins against the current scroll offset", () => {
    expect(browserCommentInspectorScript).toContain("el.dataset.pinCoordinateSpace = pin.coordinateSpace === \"page\" ? \"page\" : \"viewport\"")
    expect(browserCommentInspectorScript).toContain("el.style.left = (page ? x - window.scrollX : x) + \"px\"")
    expect(browserCommentInspectorScript).toContain("window.addEventListener(\"scroll\", positionPins, true)")
    expect(browserCommentInspectorScript).toContain('send("delete", { id: pin.id })')
  })
})
