import { describe, expect, test } from "bun:test"
import type { BrowserCommentAttachmentPart } from "@/context/prompt"
import {
  classifyBrowserCommentSource,
  compactBrowserCommentConsole,
  compactBrowserCommentStyles,
  createBrowserCommentAgentPayload,
  createBrowserCommentBatchAgentPayload,
  readReactSourceFromElement,
} from "./browser-comment"

describe("readReactSourceFromElement", () => {
  test("reads React dev _debugSource metadata", () => {
    const element = {
      "__reactFiber$fixture": {
        _debugSource: {
          fileName: "/repo/src/App.tsx",
          lineNumber: 12,
          columnNumber: 4,
        },
      },
    }

    expect(readReactSourceFromElement(element)).toEqual({
      fileName: "/repo/src/App.tsx",
      lineNumber: 12,
      columnNumber: 4,
      framework: "react-dev",
    })
  })

  test("falls back to React debug stack source locations", () => {
    const element = {
      "__reactFiber$fixture": {
        _debugStack: new Error("at Button (http://localhost:5173/src/App.tsx?t=1:18:7)"),
      },
    }

    expect(readReactSourceFromElement(element)).toEqual({
      fileName: "http://localhost:5173/src/App.tsx?t=1",
      lineNumber: 18,
      columnNumber: 7,
      framework: "react-dev",
    })
  })
})

describe("browser comment agent payloads", () => {
  test("omits empty note prose and emits compact deterministic JSON-ready data", () => {
    const payload = createBrowserCommentAgentPayload({
      comment: browserComment({ note: "   ", source: undefined }),
      index: 0,
      total: 1,
      screenshotPartID: "part_img",
    }) as Record<string, unknown>

    expect(payload.note).toBeUndefined()
    expect(payload.source).toEqual({ status: "unavailable" })
    expect(JSON.stringify(payload)).not.toContain("no note")
    expect(payload.selection).toEqual({ kind: "element", rect: { x: 10, y: 20, w: 100, h: 40 }, point: { x: 60, y: 40 } })
  })

  test("labels real source as high confidence and generated framework output as low confidence", () => {
    expect(classifyBrowserCommentSource({ fileName: "/repo/src/App.tsx", lineNumber: 12 })).toEqual({
      status: "available",
      confidence: "high",
      file: "/repo/src/App.tsx",
      line: 12,
    })

    expect(
      classifyBrowserCommentSource({
        fileName: "webpack-internal:///(app-pages-browser)/./src/app/page.tsx",
        lineNumber: 8,
        framework: "next-react",
      }),
    ).toEqual({
      status: "available",
      confidence: "low",
      file: "webpack-internal:///(app-pages-browser)/./src/app/page.tsx",
      line: 8,
      framework: "next-react",
      reason: "generated-framework-output",
    })
  })

  test("compacts rendered styles to useful visual repair fields", () => {
    expect(
      compactBrowserCommentStyles({
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgba(0, 0, 0, 0)",
        fontFamily: "system-ui, sans-serif",
        fontWeight: "400",
        display: "block",
        position: "static",
        padding: "0px",
        borderRadius: "12px",
        fontSize: "20px",
      }),
    ).toEqual({ color: "rgb(0, 0, 0)", borderRadius: "12px", fontSize: "20px" })

    expect(compactBrowserCommentStyles({ fontFamily: '"Fraunces", serif' })).toEqual({ fontFamily: '"Fraunces", serif' })
  })

  test("deduplicates and caps console warnings/errors with counts", () => {
    const result = compactBrowserCommentConsole(
      [
        { level: "warning", text: "Repeated warning", timestamp: 1 },
        { level: "warning", text: "Repeated   warning", timestamp: 2 },
        { level: "error", text: "Error one", timestamp: 3 },
        { level: "warning", text: "Extra", timestamp: 4 },
      ],
      2,
    )

    expect(result).toEqual({
      items: [
        { level: "warning", text: "Repeated warning", count: 2 },
        { level: "error", text: "Error one", count: 1 },
      ],
      omitted: 1,
    })
  })

  test("creates batch payload with capped console at batch level", () => {
    const payload = createBrowserCommentBatchAgentPayload({
      version: 1,
      commentIDs: ["bc_1", "bc_2"],
      pageUrl: "http://localhost:3000/en",
      viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
      console: [
        { level: "warning", text: "Hydration warning", timestamp: 1 },
        { level: "warning", text: "Hydration warning", timestamp: 2 },
      ],
    })

    expect(payload).toEqual({
      type: "browser_comment_batch",
      v: 1,
      comments: ["bc_1", "bc_2"],
      viewport: { w: 1200, h: 800, dpr: 2 },
      url: "http://localhost:3000/en",
      console: [{ level: "warning", text: "Hydration warning", count: 2 }],
    })
  })
})

function browserComment(input: Partial<BrowserCommentAttachmentPart>): BrowserCommentAttachmentPart {
  return {
    type: "browser-comment",
    id: "bc_1",
    kind: "element",
    note: "Make this larger",
    screenshot: { dataUrl: "data:image/png;base64,BBB", mime: "image/png", filename: "button.png" },
    rect: { x: 10, y: 20, width: 100, height: 40 },
    point: { x: 60, y: 40 },
    page: { url: "http://localhost:5173/", title: "Demo" },
    viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
    console: [],
    element: {
      tagName: "BUTTON",
      id: "cta",
      className: "primary rounded large",
      role: "button",
      text: "Start",
      attributes: { id: "cta", class: "primary rounded large", "aria-label": "Start now" },
    },
    source: { fileName: "/repo/src/App.tsx", lineNumber: 12, columnNumber: 4, framework: "react-dev" },
    styles: { color: "rgb(0, 0, 0)", fontSize: "16px" },
    createdAt: 1,
    ...input,
  }
}
