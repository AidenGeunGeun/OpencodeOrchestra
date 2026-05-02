import { Index, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { BrowserCommentAttachmentPart } from "@/context/prompt"
import { usePrompt } from "@/context/prompt"
import { classifyBrowserCommentSource } from "@/utils/browser-comment"
import { browserCommentMarker, createBrowserCommentInspectorScript } from "@/utils/browser-comment-inspector"
import { Identifier } from "@/utils/id"

type ElectronWebviewTag = HTMLElement & {
  src: string
  loadURL?: (url: string) => Promise<void>
  reload?: () => void
  goBack?: () => void
  goForward?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  getURL?: () => string
  getTitle?: () => string
  executeJavaScript?: <T = unknown>(code: string) => Promise<T>
  capturePage?: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{ toDataURL(): string }>
}

type InspectorPayload = {
  kind: "element" | "area"
  rect: BrowserCommentAttachmentPart["rect"]
  point: BrowserCommentAttachmentPart["point"]
  element?: BrowserCommentAttachmentPart["element"]
  source?: BrowserCommentAttachmentPart["source"]
  styles?: BrowserCommentAttachmentPart["styles"]
}

type ConsoleItem = BrowserCommentAttachmentPart["console"][number]

const marker = browserCommentMarker
const webviewLoadedEvents = ["did-finish-load", "did-frame-finish-load"]

export function BrowserTab() {
  const prompt = usePrompt()
  const inspectorNonce =
    safe(() => crypto.randomUUID()) ?? `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let webview: ElectronWebviewTag | undefined
  let iframe: HTMLIFrameElement | undefined
  let unwireWebview = () => {}
  const noteRefs = new Map<string, HTMLTextAreaElement>()
  let noteFocusVersion = 0
  let renderedPins = ""
  let pendingWebviewUrl = ""

  const [store, setStore] = createStore({
    urlInput: "http://localhost:3000",
    currentUrl: "",
    loading: false,
    ready: false,
    domReady: false,
    canGoBack: false,
    canGoForward: false,
    error: "",
    selectionMode: false,
    console: [] as ConsoleItem[],
    viewport: { width: 0, height: 0, deviceScaleFactor: 1 },
  })
  const [electronWebview, setElectronWebview] = createSignal(false)
  const [browserCommentCapable, setBrowserCommentCapable] = createSignal(false)
  const [webviewSrc, setWebviewSrc] = createSignal("about:blank")
  const [iframeSrc, setIframeSrc] = createSignal("about:blank")

  const comments = createMemo(() => prompt.current().filter(isBrowserComment))
  const commentCount = createMemo(() => comments().length)
  const browserCommentReady = createMemo(() => browserCommentCapable() && store.domReady)

  const normalizeUrl = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ""
    const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("Only HTTP and HTTPS URLs can be opened")
    return parsed.toString()
  }

  const executeInWebview = async <T,>(code: string) => {
    if (!webview?.executeJavaScript || !webview.isConnected || !store.domReady) return undefined
    try {
      return await webview.executeJavaScript<T>(code)
    } catch {
      return undefined
    }
  }

  const refreshWebviewCapabilities = () => {
    const canNavigate = typeof webview?.loadURL === "function"
    const canInspect = typeof webview?.executeJavaScript === "function" && typeof webview?.capturePage === "function"
    setElectronWebview(canNavigate)
    setBrowserCommentCapable(canInspect)
    return canNavigate
  }

  const currentWebviewUrl = () =>
    safe(() => webview?.getURL?.()) || webview?.getAttribute("src") || webviewSrc() || store.currentUrl

  const shouldIgnoreInitialBlank = (url: string | undefined) => Boolean(pendingWebviewUrl && (!url || url === "about:blank"))

  const markWebviewSettled = () => {
    const current = currentWebviewUrl()
    if (shouldIgnoreInitialBlank(current)) return false
    if (pendingWebviewUrl && current) pendingWebviewUrl = ""
    return true
  }

  const updateNavState = () => {
    const currentUrl = electronWebview()
      ? shouldIgnoreInitialBlank(currentWebviewUrl())
        ? store.currentUrl || pendingWebviewUrl
        : currentWebviewUrl()
      : iframe?.src || store.currentUrl
    const viewportElement = electronWebview() ? webview : iframe
    setStore({
      currentUrl,
      urlInput: currentUrl || store.urlInput,
      canGoBack: electronWebview() ? (safe(() => webview?.canGoBack?.()) ?? false) : false,
      canGoForward: electronWebview() ? (safe(() => webview?.canGoForward?.()) ?? false) : false,
      viewport: {
        width: viewportElement?.clientWidth ?? 0,
        height: viewportElement?.clientHeight ?? 0,
        deviceScaleFactor: window.devicePixelRatio || 1,
      },
    })
    refreshBatchMetadata()
  }

  const installInspector = async () => {
    if (!webview?.executeJavaScript || !store.domReady) return
    const installed = await executeInWebview<boolean>("window.__ocoBrowserCommentsInstalled === true")
    if (!installed) await executeInWebview(createBrowserCommentInspectorScript(inspectorNonce))
    syncSelectionMode()
    renderPins()
  }

  const invalidateRenderedPins = () => {
    renderedPins = ""
  }

  const syncSelectionMode = () => {
    if (!webview?.executeJavaScript || !store.ready || !store.domReady) return
    void executeInWebview(`window.__ocoBrowserComments?.setActive?.(${store.selectionMode ? "true" : "false"});`)
  }

  const navigate = async () => {
    if (!webview) return
    try {
      const next = normalizeUrl(store.urlInput)
      if (!next) return
      invalidateRenderedPins()
      setStore({ error: "", loading: true, ready: false, domReady: false, currentUrl: next, console: [] })
      let useElectronWebview = refreshWebviewCapabilities()
      if (!useElectronWebview) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        useElectronWebview = refreshWebviewCapabilities()
      }
      if (useElectronWebview) {
        pendingWebviewUrl = next
        setWebviewSrc(next)
        webview.setAttribute("src", next)
      } else {
        setIframeSrc(next)
        setStore({ loading: false, ready: true })
        requestAnimationFrame(updateNavState)
      }
    } catch (err) {
      setStore("error", err instanceof Error ? err.message : "Could not open URL")
    }
  }

  const captureSelection = async (payload: InspectorPayload) => {
    if (!webview?.capturePage) return fallbackImage(payload.kind)
    const rect = clampRect(payload.rect, webview.clientWidth, webview.clientHeight)
    if (!rect) return fallbackImage(payload.kind)
    const image = await webview.capturePage(rect).catch(() => undefined)
    return image?.toDataURL() || fallbackImage(payload.kind)
  }

  const addComment = async (payload: InspectorPayload) => {
    const id = Identifier.ascending("part")
    const screenshot = await captureSelection(payload)
    const pageUrl = store.currentUrl || safe(() => webview?.getURL?.()) || ""
    const comment: BrowserCommentAttachmentPart = {
      type: "browser-comment",
      id,
      kind: payload.kind,
      note: "",
      screenshot: {
        dataUrl: screenshot,
        mime: "image/png",
        filename: `${payload.kind}-selection-${comments().length + 1}.png`,
      },
      rect: payload.rect,
      point: payload.point,
      page: { url: pageUrl, title: safe(() => webview?.getTitle?.()) || undefined },
      viewport: store.viewport,
      console: store.console.slice(-50),
      element: payload.element,
      source: payload.source,
      styles: payload.styles,
      createdAt: Date.now(),
    }
    prompt.set([...prompt.current(), comment], prompt.cursor())
  }

  const updateComment = (id: string, next: Partial<BrowserCommentAttachmentPart>) => {
    prompt.set(
      prompt.current().map((part) => (part.type === "browser-comment" && part.id === id ? { ...part, ...next } : part)),
      prompt.cursor(),
    )
  }

  const updateCommentNote = (id: string, event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const target = event.currentTarget
    const selectionStart = target.selectionStart
    const selectionEnd = target.selectionEnd
    const version = ++noteFocusVersion
    updateComment(id, { note: target.value })

    requestAnimationFrame(() => {
      if (version !== noteFocusVersion) return
      const next = noteRefs.get(id) ?? target
      if (!next.isConnected) return
      if (document.activeElement !== next) next.focus({ preventScroll: true })
      safe(() => next.setSelectionRange(selectionStart, selectionEnd))
    })
  }

  const removeComment = (id: string) => {
    prompt.set(
      prompt.current().filter((part) => part.type !== "browser-comment" || part.id !== id),
      prompt.cursor(),
    )
  }

  const clearComments = () => {
    prompt.set(
      prompt.current().filter((part) => part.type !== "browser-comment"),
      prompt.cursor(),
    )
  }

  const refreshBatchMetadata = () => {
    const nextUrl = store.currentUrl || safe(() => webview?.getURL?.()) || iframe?.src || ""
    const nextViewport = store.viewport
    const nextConsole = store.console.slice(-50)
    const list = comments()
    if (list.length === 0) return
    prompt.set(
      prompt.current().map((part) => {
        if (part.type !== "browser-comment") return part
        if (!list.find((item) => item.id === part.id)) return part
        return {
          ...part,
          page: { ...part.page, url: nextUrl || part.page.url },
          viewport: nextViewport,
          console: nextConsole,
        }
      }),
      prompt.cursor(),
    )
  }

  const renderPins = () => {
    if (!webview?.executeJavaScript || !store.ready || !store.domReady) return
    const pins = comments().map((comment, index) => ({ id: comment.id, index, x: comment.point.x, y: comment.point.y }))
    const serialized = JSON.stringify(pins)
    if (serialized === renderedPins) return
    renderedPins = serialized
    void executeInWebview(
      `window.__ocoBrowserComments?.clearPins?.(); ${serialized}.forEach((pin) => window.__ocoBrowserComments?.addPin?.(pin));`,
    )
  }

  const wireWebview = (el: ElectronWebviewTag) => {
    unwireWebview()
    webview = el
    refreshWebviewCapabilities()
    invalidateRenderedPins()
    setStore("domReady", false)
    const onDomReady = () => {
      refreshWebviewCapabilities()
      if (!markWebviewSettled()) return
      invalidateRenderedPins()
      setStore({ ready: true, loading: false, domReady: true })
      void installInspector()
      updateNavState()
    }
    const onLoading = () => {
      refreshWebviewCapabilities()
      invalidateRenderedPins()
      setStore({ loading: true, ready: false, domReady: false })
    }
    const onLoaded = () => {
      refreshWebviewCapabilities()
      if (!markWebviewSettled()) return
      invalidateRenderedPins()
      setStore({ loading: false, ready: true })
      updateNavState()
      void installInspector()
    }
    const onFailed = (event: Event) => {
      const data = event as Event & {
        errorCode?: number
        errorDescription?: string
        validatedURL?: string
        isMainFrame?: boolean
      }
      if (data.isMainFrame === false || data.errorCode === -3) return
      if (shouldIgnoreInitialBlank(data.validatedURL)) return
      pendingWebviewUrl = ""
      setStore({
        loading: false,
        ready: false,
        domReady: false,
        currentUrl: data.validatedURL || store.currentUrl,
        error: data.errorDescription || "Could not open URL",
      })
    }
    const capabilityFrame = window.requestAnimationFrame(refreshWebviewCapabilities)
    const capabilityTimers = [0, 50, 250].map((delay) => window.setTimeout(refreshWebviewCapabilities, delay))
    const retry = window.setInterval(() => {
      refreshWebviewCapabilities()
      if (store.domReady) void installInspector()
    }, 1000)
    const onConsole = (event: Event) => {
      const data = event as Event & { message?: string; level?: number }
      const message = data.message ?? ""
      if (message.startsWith(marker)) {
        const parsed = parseInspectorMessage(message)
        if (parsed?.nonce !== inspectorNonce) return
        if (parsed?.type === "selection" && store.selectionMode) void addComment(parsed.payload as InspectorPayload)
        if (
          parsed?.type === "delete" &&
          store.selectionMode &&
          typeof (parsed.payload as { id?: unknown }).id === "string"
        ) {
          removeComment((parsed.payload as { id: string }).id)
        }
        return
      }
      const level = data.level === 2 ? "warning" : data.level === 3 ? "error" : undefined
      if (!level) return
      setStore("console", (items) => [...items.slice(-49), { level, text: message, timestamp: Date.now() }])
      refreshBatchMetadata()
    }
    webview.addEventListener("dom-ready", onDomReady)
    for (const event of webviewLoadedEvents) webview.addEventListener(event, onLoaded)
    webview.addEventListener("did-start-loading", onLoading)
    webview.addEventListener("did-fail-load", onFailed)
    webview.addEventListener("did-stop-loading", onLoaded)
    webview.addEventListener("did-navigate", onLoaded)
    webview.addEventListener("did-navigate-in-page", onLoaded)
    webview.addEventListener("console-message", onConsole)
    unwireWebview = () => {
      if (!webview) return
      window.cancelAnimationFrame(capabilityFrame)
      for (const timer of capabilityTimers) window.clearTimeout(timer)
      window.clearInterval(retry)
      webview.removeEventListener("dom-ready", onDomReady)
      for (const event of webviewLoadedEvents) webview.removeEventListener(event, onLoaded)
      webview.removeEventListener("did-start-loading", onLoading)
      webview.removeEventListener("did-fail-load", onFailed)
      webview.removeEventListener("did-stop-loading", onLoaded)
      webview.removeEventListener("did-navigate", onLoaded)
      webview.removeEventListener("did-navigate-in-page", onLoaded)
      webview.removeEventListener("console-message", onConsole)
    }
    updateNavState()
  }

  onCleanup(() => unwireWebview())

  const goBack = () => safe(() => webview?.goBack?.())
  const goForward = () => safe(() => webview?.goForward?.())
  const reload = () => {
    if (webview?.reload) return safe(() => webview?.reload?.())
    if (!iframe) return
    iframe.src = iframe.src
  }

  createEffect(() => {
    comments()
      .map((comment) => `${comment.id}:${comment.point.x}:${comment.point.y}`)
      .join("|")
    renderPins()
  })

  createEffect(() => {
    store.selectionMode
    syncSelectionMode()
  })

  createEffect(() => {
    if (browserCommentReady()) return
    if (store.selectionMode) setStore("selectionMode", false)
  })

  return (
    <div class="h-full min-h-0 flex bg-background-base" data-prevent-autofocus>
      <div class="min-w-0 flex-1 flex flex-col border-r border-border-weaker-base">
        <form
          class="shrink-0 flex items-center gap-1.5 px-2 py-2 border-b border-border-weaker-base bg-background-stronger"
          onSubmit={(event) => {
            event.preventDefault()
            void navigate()
          }}
        >
          <Button
            type="button"
            variant="ghost"
            class="h-7 px-2"
            disabled={!store.canGoBack}
            onClick={goBack}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="h-7 px-2"
            disabled={!store.canGoForward}
            onClick={goForward}
          >
            Forward
          </Button>
          <Button type="button" variant="ghost" class="h-7 px-2" onClick={reload}>
            Reload
          </Button>
          <Button
            type="button"
            variant={store.selectionMode && browserCommentReady() ? "primary" : "ghost"}
            class="h-8 px-3"
            disabled={!browserCommentReady()}
            title={browserCommentReady() ? undefined : "Selection is available after the embedded browser is ready"}
            onClick={() => {
              if (!browserCommentReady()) return
              setStore("selectionMode", (value) => !value)
            }}
            aria-pressed={store.selectionMode}
          >
            {store.selectionMode && browserCommentReady() ? "Selecting" : "Select"}
          </Button>
          <input
            value={store.urlInput}
            onInput={(event) => setStore("urlInput", event.currentTarget.value)}
            placeholder="http://localhost:3000"
            class="min-w-0 flex-1 h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong outline-none focus:border-border-strong-base"
          />
          <Button type="submit" variant="primary" class="h-8 px-3">
            Open
          </Button>
        </form>
        <Show when={store.error}>
          <div class="px-3 py-2 text-12-regular text-text-danger-base">{store.error}</div>
        </Show>
        <div class="relative min-h-0 flex-1 bg-background-stronger">
          <webview
            ref={(el) => wireWebview(el as ElectronWebviewTag)}
            src={webviewSrc()}
            partition="oco-browser-comments"
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            class="absolute inset-0 size-full bg-white"
            classList={{ hidden: !electronWebview() }}
          />
          <iframe
            ref={iframe}
            src={iframeSrc()}
            class="absolute inset-0 size-full border-0 bg-white"
            classList={{ hidden: electronWebview() }}
            onLoad={() => {
              if (electronWebview()) return
              setStore({ loading: false, ready: true, currentUrl: iframe?.src || store.currentUrl })
              updateNavState()
            }}
          />
          <Show when={store.loading}>
            <div class="absolute top-2 left-2 rounded-md bg-background-base/90 border border-border-weak-base px-2 py-1 text-11-medium text-text-weak shadow-sm">
              Loading...
            </div>
          </Show>
          <Show when={store.selectionMode && browserCommentReady()}>
            <div class="absolute top-2 right-2 rounded-md bg-surface-warning-strong text-white px-2 py-1 text-11-medium shadow-sm pointer-events-none">
              Comment selection on
            </div>
          </Show>
        </div>
        <div
          class="shrink-0 px-3 py-2 border-t text-11-regular"
          classList={{
            "border-border-warning-base bg-surface-warning-weak text-text-strong": store.selectionMode,
            "border-border-weaker-base text-text-weak": !store.selectionMode,
          }}
        >
          {!browserCommentCapable()
            ? "Preview-only in this desktop shell. You can load localhost, but element selection and screenshots need the Electron browser view."
            : !store.domReady
              ? "Browser is attaching. Selection will be available once the page is ready."
            : store.selectionMode
              ? "Selection mode is active: click elements to queue comments, or shift-drag to capture an area."
              : "Browse normally. Turn on Select when you want to point out page issues."}
        </div>
      </div>

      <div class="w-64 shrink-0 min-h-0 flex flex-col bg-background-stronger">
        <div class="shrink-0 px-3 py-2 border-b border-border-weaker-base flex items-center justify-between gap-2">
          <div class="text-12-medium text-text-strong">Browser comments ({commentCount()})</div>
          <Button
            type="button"
            variant="ghost"
            class="h-7 px-2"
            disabled={commentCount() === 0}
            onClick={clearComments}
          >
            Clear
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          <Show
            when={commentCount() > 0}
            fallback={
              <div class="pt-16 text-center text-12-regular text-text-weak">
                Selections appear here before you send.
              </div>
            }
          >
            <Index each={comments()}>
              {(comment, index) => (
                <div class="rounded-lg border border-border-weak-base bg-background-base overflow-hidden">
                  <div class="relative">
                    <img
                      src={comment().screenshot.dataUrl}
                      alt="Browser comment thumbnail"
                      class="w-full h-28 object-cover bg-white"
                    />
                    <div class="absolute top-2 left-2 size-6 rounded-full bg-surface-warning-strong text-white text-12-medium flex items-center justify-center shadow-sm">
                      {index + 1}
                    </div>
                    <button
                      type="button"
                      class="absolute top-2 right-2 size-6 rounded-full bg-background-base/90 border border-border-weak-base flex items-center justify-center"
                      onClick={() => removeComment(comment().id)}
                      aria-label="Delete browser comment"
                    >
                      <Icon name="close" class="size-3 text-text-weak" />
                    </button>
                  </div>
                  <div class="p-2 space-y-2">
                    <textarea
                      ref={(el) => noteRefs.set(comment().id, el)}
                      value={comment().note}
                      onInput={(event) => updateCommentNote(comment().id, event)}
                      onKeyDown={(event) => event.stopPropagation()}
                      data-prevent-autofocus
                      placeholder="Add a note for the agent"
                      class="w-full min-h-18 resize-y rounded-md border border-border-weak-base bg-background-stronger px-2 py-1.5 text-12-regular text-text-strong outline-none focus:border-border-strong-base"
                    />
                    <div class="text-10-regular text-text-weak truncate">{sourcePreview(comment())}</div>
                  </div>
                </div>
              )}
            </Index>
          </Show>
        </div>
      </div>
    </div>
  )
}

function isBrowserComment(part: unknown): part is BrowserCommentAttachmentPart {
  return !!part && typeof part === "object" && (part as { type?: unknown }).type === "browser-comment"
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

function sourcePreview(comment: BrowserCommentAttachmentPart) {
  const source = classifyBrowserCommentSource(comment.source)
  if (source.status === "unavailable") return "Source unavailable"
  if (source.confidence === "low") return "Low-confidence generated source"
  return `${source.file}${source.line ? `:${source.line}` : ""}`
}

function clampRect(rect: BrowserCommentAttachmentPart["rect"], width: number, height: number) {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)))
  const right = Math.max(x + 1, Math.min(width, Math.ceil(rect.x + rect.width)))
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(rect.y + rect.height)))
  const next = { x, y, width: right - x, height: bottom - y }
  if (next.width < 1 || next.height < 1) return
  return next
}

function fallbackImage(kind: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f6f8fa"/><text x="160" y="90" text-anchor="middle" fill="#57606a" font-family="sans-serif" font-size="14">${kind} selection screenshot unavailable</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

function parseInspectorMessage(
  message: string,
): { type: string; payload: InspectorPayload | { id: string }; nonce?: string } | undefined {
  try {
    return JSON.parse(message.slice(marker.length))
  } catch {
    return undefined
  }
}
