import { describe, expect, test } from "bun:test"

describe("ResizeHandle drag cleanup", () => {
  test("uses pointer capture and fallback cleanup for embedded desktop surfaces", async () => {
    const source = await Bun.file(new URL("./resize-handle.tsx", import.meta.url)).text()

    expect(source).toContain("setPointerCapture(pointerID)")
    expect(source).toContain("e.stopPropagation()")
    expect(source).toContain('window.addEventListener("pointercancel", onPointerEnd, true)')
    expect(source).toContain('window.addEventListener("blur", end, true)')
    expect(source).toContain('window.addEventListener("mouseup", onMouseUpFallback, true)')
    expect(source).toContain("moveEvent.buttons === 0")
    expect(source).toContain('data-component", "resize-capture-overlay"')
  })
})
