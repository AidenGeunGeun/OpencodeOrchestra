import type { BrowserCommentAttachmentPart, BrowserCommentSourceLocation } from "@/context/prompt"

const CONSOLE_LIMIT = 8

type CompactSource =
  | {
      status: "available"
      confidence: "high" | "low"
      file: string
      line?: number
      column?: number
      framework?: string
      reason?: string
    }
  | { status: "unavailable" }

type CompactConsoleItem = {
  level: "warning" | "error"
  text: string
  count: number
}

export type BrowserCommentMetadata = {
  version: 1
  id: string
  screenshotPartID: string
  comment: BrowserCommentAttachmentPart
}

export type BrowserCommentBatchMetadata = {
  version: 1
  commentIDs: string[]
  pageUrl: string
  viewport: BrowserCommentAttachmentPart["viewport"]
  console: BrowserCommentAttachmentPart["console"]
}

export function compactBrowserCommentConsole(items: BrowserCommentAttachmentPart["console"], limit = CONSOLE_LIMIT) {
  const byKey = new Map<string, CompactConsoleItem>()
  for (const item of items) {
    const text = compactText(item.text, 500)
    if (!text) continue
    const key = `${item.level}\u0000${text}`
    const existing = byKey.get(key)
    if (existing) {
      existing.count++
      continue
    }
    byKey.set(key, { level: item.level, text, count: 1 })
  }

  return {
    items: Array.from(byKey.values()).slice(0, limit),
    omitted: Math.max(0, byKey.size - limit),
  }
}

export function classifyBrowserCommentSource(source: BrowserCommentSourceLocation | undefined): CompactSource {
  if (!source?.fileName?.trim()) return { status: "unavailable" }

  const file = source.fileName.trim()
  const generated = isGeneratedSource(file)
  const result: CompactSource = {
    status: "available",
    confidence: generated ? "low" : "high",
    file,
  }
  if (source.lineNumber) result.line = source.lineNumber
  if (source.columnNumber) result.column = source.columnNumber
  if (source.framework) result.framework = source.framework
  if (generated) result.reason = "generated-framework-output"
  return result
}

export function compactBrowserCommentStyles(styles: BrowserCommentAttachmentPart["styles"] | undefined) {
  if (!styles) return undefined
  const out: Record<string, string> = {}
  const add = (from: string, to = from) => {
    const value = compactStyleValue(styles[from])
    if (!value) return
    if (isLowValueStyle(from, value)) return
    out[to] = value
  }

  add("color")
  add("backgroundColor", "background")
  add("fontFamily")
  add("fontSize")
  add("fontWeight")
  add("lineHeight")
  add("display")
  add("position")
  add("width")
  add("height")
  add("margin")
  add("padding")
  add("borderRadius")
  add("zIndex")
  add("justifyContent")
  add("alignItems")
  add("gridTemplateColumns")
  add("flexDirection")

  return Object.keys(out).length ? out : undefined
}

export function createBrowserCommentAgentPayload(input: {
  comment: BrowserCommentAttachmentPart
  index: number
  total: number
  screenshotPartID: string
}) {
  const item = input.comment
  const payload: Record<string, unknown> = {
    type: "browser_comment",
    v: 1,
    id: item.id,
    index: input.index + 1,
    total: input.total,
    image: { partID: input.screenshotPartID, filename: item.screenshot.filename },
    selection: {
      kind: item.kind,
      rect: compactRect(item.rect),
      point: compactPoint(item.point),
    },
    source: classifyBrowserCommentSource(item.source),
  }

  const note = item.note.trim()
  if (note) payload.note = note
  const element = compactElement(item.element)
  if (element) payload.element = element
  const styles = compactBrowserCommentStyles(item.styles)
  if (styles) payload.styles = styles

  return payload
}

export function createBrowserCommentBatchAgentPayload(input: BrowserCommentBatchMetadata) {
  const payload: Record<string, unknown> = {
    type: "browser_comment_batch",
    v: 1,
    comments: input.commentIDs,
    viewport: compactViewport(input.viewport),
  }
  if (input.pageUrl) payload.url = input.pageUrl

  const consoleItems = compactBrowserCommentConsole(input.console)
  if (consoleItems.items.length > 0) {
    payload.console = consoleItems.omitted ? consoleItems : consoleItems.items
  }

  return payload
}

export function createBrowserCommentMetadata(input: BrowserCommentMetadata) {
  return {
    ocoBrowserComment: input,
  }
}

export function createBrowserCommentBatchMetadata(input: BrowserCommentBatchMetadata) {
  return {
    ocoBrowserCommentBatch: input,
  }
}

export function readBrowserCommentMetadata(value: unknown): BrowserCommentMetadata | undefined {
  if (!value || typeof value !== "object") return
  const meta = (value as { ocoBrowserComment?: unknown }).ocoBrowserComment
  if (!meta || typeof meta !== "object") return
  const version = (meta as { version?: unknown }).version
  const id = (meta as { id?: unknown }).id
  const screenshotPartID = (meta as { screenshotPartID?: unknown }).screenshotPartID
  const comment = (meta as { comment?: unknown }).comment
  if (version !== 1 || typeof id !== "string" || typeof screenshotPartID !== "string") return
  if (!comment || typeof comment !== "object" || (comment as { type?: unknown }).type !== "browser-comment") return
  return { version, id, screenshotPartID, comment: comment as BrowserCommentAttachmentPart }
}

export function readBrowserCommentBatchMetadata(value: unknown): BrowserCommentBatchMetadata | undefined {
  if (!value || typeof value !== "object") return
  const meta = (value as { ocoBrowserCommentBatch?: unknown }).ocoBrowserCommentBatch
  if (!meta || typeof meta !== "object") return
  const version = (meta as { version?: unknown }).version
  const commentIDs = (meta as { commentIDs?: unknown }).commentIDs
  const pageUrl = (meta as { pageUrl?: unknown }).pageUrl
  const viewport = (meta as { viewport?: unknown }).viewport
  const consoleItems = (meta as { console?: unknown }).console
  if (version !== 1 || !Array.isArray(commentIDs) || typeof pageUrl !== "string") return
  if (!viewport || typeof viewport !== "object" || !Array.isArray(consoleItems)) return
  return {
    version,
    commentIDs: commentIDs.filter((id): id is string => typeof id === "string"),
    pageUrl,
    viewport: viewport as BrowserCommentBatchMetadata["viewport"],
    console: consoleItems as BrowserCommentBatchMetadata["console"],
  }
}

export function formatBrowserCommentBatch(input: BrowserCommentBatchMetadata) {
  return JSON.stringify(createBrowserCommentBatchAgentPayload(input))
}

export function formatBrowserComment(input: {
  comment: BrowserCommentAttachmentPart
  index: number
  total: number
  screenshotPartID: string
}) {
  return JSON.stringify(createBrowserCommentAgentPayload(input))
}

export function readReactSourceFromElement(element: unknown): BrowserCommentSourceLocation | undefined {
  if (!element || typeof element !== "object") return
  let node: any = element
  for (let depth = 0; depth < 6 && node; depth++) {
    const keys = Object.keys(node)
    const fiberKey = keys.find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"))
    const fiber = fiberKey ? node[fiberKey] : node.return ? node : undefined
    const source = sourceFromFiber(fiber)
    if (source) return source
    node = fiber?.return
  }
}

function sourceFromFiber(fiber: any): BrowserCommentSourceLocation | undefined {
  let current = fiber
  for (let depth = 0; depth < 24 && current; depth++) {
    const source = current._debugSource ?? current._debugOwner?._debugSource ?? current.elementType?._debugSource
    if (source && typeof source.fileName === "string") {
      return {
        fileName: source.fileName,
        lineNumber: number(source.lineNumber),
        columnNumber: number(source.columnNumber),
        framework: source.fileName.includes("/_next/") || source.fileName.includes("next/") ? "next-react" : "react-dev",
      }
    }
    const stackSource = sourceFromStack(current._debugStack ?? current._debugOwner?._debugStack)
    if (stackSource) return stackSource
    current = current.return
  }
}

function sourceFromStack(stack: unknown): BrowserCommentSourceLocation | undefined {
  const text = stack instanceof Error ? stack.stack : typeof stack === "string" ? stack : undefined
  if (!text) return
  const match = text.match(/(?:\(|\s)([^\s()]+\.(?:tsx|ts|jsx|js|vue|svelte|astro)(?:\?[^:)]*)?):(\d+):(\d+)(?:\)|\s|$)/)
  if (!match) return
  return {
    fileName: match[1],
    lineNumber: number(match[2]),
    columnNumber: number(match[3]),
    framework: match[1].includes("/_next/") || match[1].includes("webpack-internal://") ? "next-react" : "react-dev",
  }
}

function number(value: unknown) {
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function compactRect(rect: BrowserCommentAttachmentPart["rect"]) {
  return { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) }
}

function compactPoint(point: BrowserCommentAttachmentPart["point"]) {
  return { x: round(point.x), y: round(point.y) }
}

function compactViewport(viewport: BrowserCommentAttachmentPart["viewport"]) {
  const out: Record<string, number> = { w: round(viewport.width), h: round(viewport.height) }
  if (viewport.deviceScaleFactor && viewport.deviceScaleFactor !== 1) out.dpr = round(viewport.deviceScaleFactor)
  return out
}

function compactElement(element: BrowserCommentAttachmentPart["element"] | undefined) {
  if (!element) return undefined
  const out: Record<string, unknown> = { tag: element.tagName.toLowerCase() }
  if (element.id) out.id = element.id
  const classes = compactClassList(element.className)
  if (classes.length > 0) out.classes = classes
  if (element.role) out.role = element.role
  const text = compactText(element.text, 180)
  if (text) out.text = text

  const attrs = compactAttributes(element.attributes)
  if (Object.keys(attrs).length > 0) out.attrs = attrs
  return out
}

function compactAttributes(attributes: Record<string, string>) {
  const out: Record<string, string> = {}
  const skipped = new Set(["id", "class", "role"])
  for (const [key, value] of Object.entries(attributes)) {
    if (skipped.has(key)) continue
    if (!isUsefulAttribute(key)) continue
    const next = compactText(value, 160)
    if (next) out[key] = next
    if (Object.keys(out).length >= 8) break
  }
  return out
}

function compactClassList(value: string | undefined) {
  return (value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function isUsefulAttribute(key: string) {
  return ["aria-label", "href", "src", "alt", "title", "data-testid"].includes(key) || key.startsWith("data-")
}

function isGeneratedSource(file: string) {
  return ["/_next/", "/.next/", "webpack-internal://", "webpack://", "/node_modules/next/", "/next/dist/"].some(
    (marker) => file.includes(marker),
  )
}

function compactStyleValue(value: unknown) {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text || undefined
}

function isLowValueStyle(key: string, value: string) {
  const normalized = value.toLowerCase()
  if (key === "backgroundColor") return ["rgba(0, 0, 0, 0)", "transparent"].includes(normalized)
  if (key === "fontFamily") return isDefaultFontFamily(normalized)
  if (key === "fontWeight") return normalized === "400" || normalized === "normal"
  if (key === "lineHeight") return normalized === "normal"
  if (key === "display") return normalized === "block"
  if (key === "position") return normalized === "static"
  if (key === "zIndex") return normalized === "auto"
  if (key === "justifyContent" || key === "alignItems") return normalized === "normal" || normalized === "stretch"
  if (key === "flexDirection") return normalized === "row"
  if (key === "gridTemplateColumns") return normalized === "none"
  if (["margin", "padding", "borderRadius"].includes(key)) return /^0(?:px)?(?: 0(?:px)?){0,3}$/.test(normalized)
  return false
}

function isDefaultFontFamily(value: string) {
  const defaults = new Set(["system-ui", "ui-sans-serif", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "arial", "sans-serif"])
  const fonts = value
    .replace(/["']/g, "")
    .split(",")
    .map((font) => font.trim())
    .filter(Boolean)
  return fonts.length > 0 && fonts.every((font) => defaults.has(font))
}

function compactText(value: unknown, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
