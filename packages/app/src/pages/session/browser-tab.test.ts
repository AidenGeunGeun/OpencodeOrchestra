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
    expect(source).toContain('setStore({ error: "", loading: true, ready: false, domReady: false, currentUrl: next, console: [] })')
    expect(source).toContain("setStore({ loading: true, ready: false, domReady: false })")
    expect(source).toContain("setStore({ loading: false, ready: true })")
  })

  test("falls back when Electron webview loadURL is unavailable", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain("const refreshWebviewCapabilities = () =>")
    expect(source).toContain('const canNavigate = typeof webview?.loadURL === "function"')
    expect(source).toContain("setBrowserCommentCapable")
    expect(source).toContain("let useElectronWebview = refreshWebviewCapabilities()")
    expect(source).toContain("await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))")
    expect(source).toContain("if (useElectronWebview)")
    expect(source).toContain("setIframeSrc(next)")
    expect(source).toContain("<iframe")
    expect(source).toContain("Preview-only in this desktop shell")
    expect(source).toContain("disabled={!browserCommentReady()}")
  })

  test("rechecks webview capability after Electron upgrades the element", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain("refreshWebviewCapabilities()")
    expect(source).toContain("const capabilityFrame = window.requestAnimationFrame(refreshWebviewCapabilities)")
    expect(source).toContain("const capabilityTimers = [0, 50, 250].map")
    expect(source).toContain("window.cancelAnimationFrame(capabilityFrame)")
    expect(source).toContain("for (const timer of capabilityTimers) window.clearTimeout(timer)")
    expect(source).toContain('webview.addEventListener("dom-ready", onDomReady)')
  })

  test("keeps Electron webview navigation from being overwritten by initial about:blank", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain('const [webviewSrc, setWebviewSrc] = createSignal("about:blank")')
    expect(source).toContain('let pendingWebviewUrl = ""')
    expect(source).toContain("setWebviewSrc(next)")
    expect(source).toContain('webview.setAttribute("src", next)')
    expect(source).toContain("shouldIgnoreInitialBlank")
    expect(source).toContain("if (!markWebviewSettled()) return")
    expect(source).toContain('webview.addEventListener("did-fail-load", onFailed)')
    expect(source).toContain('webview.removeEventListener("did-fail-load", onFailed)')
    expect(source).toContain('data.errorCode === -3')
    expect(source).toContain("src={webviewSrc()}")
    expect(source).not.toContain('src="about:blank"')
  })

  test("does not execute browser comment scripts before Electron webview dom-ready", async () => {
    const source = await Bun.file(new URL("./browser-tab.tsx", import.meta.url)).text()

    expect(source).toContain("domReady: false")
    expect(source).toContain("const browserCommentReady = createMemo(() => browserCommentCapable() && store.domReady)")
    expect(source).toContain("if (!webview?.executeJavaScript || !webview.isConnected || !store.domReady) return undefined")
    expect(source).toContain('webview.addEventListener("dom-ready", onDomReady)')
    expect(source).toContain('webview.removeEventListener("dom-ready", onDomReady)')
    expect(source).not.toContain("void installInspector()\n    updateNavState()")
  })
})
