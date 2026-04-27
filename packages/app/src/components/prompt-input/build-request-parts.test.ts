import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { buildRequestParts } from "./build-request-parts"

describe("buildRequestParts", () => {
  test("builds typed request and optimistic parts without cast path", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
      text: "hello @src/foo.ts @planner",
      messageID: "msg_1",
      sessionID: "ses_1",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts[0]?.type).toBe("text")
    expect(result.requestParts.some((part) => part.type === "agent")).toBe(true)
    expect(
      result.requestParts.some((part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts")),
    ).toBe(true)
    expect(result.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect(
      result.requestParts.some(
        (part) =>
          part.type === "text" &&
          part.synthetic &&
          part.metadata?.opencodeComment &&
          (part.metadata.opencodeComment as { comment?: string }).comment === "check this",
      ),
    ).toBe(true)

    expect(result.optimisticParts).toHaveLength(result.requestParts.length)
    expect(result.optimisticParts.every((part) => part.sessionID === "ses_1" && part.messageID === "msg_1")).toBe(true)
  })

  test("deduplicates context files when prompt already includes same path", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
      ],
      images: [],
      text: "@src/foo.ts",
      messageID: "msg_2",
      sessionID: "ses_2",
      sessionDirectory: "/repo",
    })

    const fooFiles = result.requestParts.filter(
      (part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts"),
    )
    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)

    expect(fooFiles).toHaveLength(2)
    expect(synthetic).toHaveLength(1)
  })

  test("handles Windows paths correctly (simulated on macOS)", () => {
    const prompt: Prompt = [{ type: "file", path: "src\\foo.ts", content: "@src\\foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\foo.ts",
      messageID: "msg_win_1",
      sessionID: "ses_win_1",
      sessionDirectory: "D:\\projects\\myapp", // Windows path
    })

    // Should create valid file URLs
    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should not have encoded backslashes in wrong place
      expect(filePart.url).not.toContain("%5C")
      // Should have normalized to forward slashes
      expect(filePart.url).toContain("/src/foo.ts")
    }
  })

  test("handles Windows absolute path with special characters", () => {
    const prompt: Prompt = [{ type: "file", path: "file#name.txt", content: "@file#name.txt", start: 0, end: 14 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@file#name.txt",
      messageID: "msg_win_2",
      sessionID: "ses_win_2",
      sessionDirectory: "C:\\Users\\test\\Documents", // Windows path
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Special chars should be encoded
      expect(filePart.url).toContain("file%23name.txt")
      // Should have Windows drive letter properly encoded
      expect(filePart.url).toMatch(/file:\/\/\/[A-Z]:/)
    }
  })

  test("handles Linux absolute paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 10 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src/app.ts",
      messageID: "msg_linux_1",
      sessionID: "ses_linux_1",
      sessionDirectory: "/home/user/project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///home/user/project/src/app.ts")
    }
  })

  test("handles macOS paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "README.md", content: "@README.md", start: 0, end: 9 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@README.md",
      messageID: "msg_mac_1",
      sessionID: "ses_mac_1",
      sessionDirectory: "/Users/kelvin/Projects/opencode",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///Users/kelvin/Projects/opencode/README.md")
    }
  })

  test("handles context files with Windows paths", () => {
    const prompt: Prompt = []

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:1", type: "file", path: "src\\utils\\helper.ts" },
        { key: "ctx:2", type: "file", path: "test\\unit.test.ts", comment: "check tests" },
      ],
      images: [],
      text: "test",
      messageID: "msg_win_ctx",
      sessionID: "ses_win_ctx",
      sessionDirectory: "D:\\workspace\\app",
    })

    const fileParts = result.requestParts.filter((part) => part.type === "file")
    expect(fileParts).toHaveLength(2)

    // All file URLs should be valid
    fileParts.forEach((part) => {
      if (part.type === "file") {
        expect(() => new URL(part.url)).not.toThrow()
        expect(part.url).not.toContain("%5C") // No encoded backslashes
      }
    })
  })

  test("handles absolute Windows paths (user manually specifies full path)", () => {
    const prompt: Prompt = [
      { type: "file", path: "D:\\other\\project\\file.ts", content: "@D:\\other\\project\\file.ts", start: 0, end: 25 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@D:\\other\\project\\file.ts",
      messageID: "msg_abs",
      sessionID: "ses_abs",
      sessionDirectory: "C:\\current\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should handle absolute path that differs from sessionDirectory
      expect(() => new URL(filePart.url)).not.toThrow()
      expect(filePart.url).toContain("/D:/other/project/file.ts")
    }
  })

  test("handles selection with query parameters on Windows", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src\\App.tsx",
        content: "@src\\App.tsx",
        start: 0,
        end: 11,
        selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\App.tsx",
      messageID: "msg_sel",
      sessionID: "ses_sel",
      sessionDirectory: "C:\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should have query parameters
      expect(filePart.url).toContain("?start=10&end=20")
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Query params should parse correctly
      const url = new URL(filePart.url)
      expect(url.searchParams.get("start")).toBe("10")
      expect(url.searchParams.get("end")).toBe("20")
    }
  })

  test("handles file paths with dots and special segments on Windows", () => {
    const prompt: Prompt = [
      { type: "file", path: "..\\..\\shared\\util.ts", content: "@..\\..\\shared\\util.ts", start: 0, end: 21 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@..\\..\\shared\\util.ts",
      messageID: "msg_dots",
      sessionID: "ses_dots",
      sessionDirectory: "C:\\projects\\myapp\\src",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should preserve .. segments (backend normalizes)
      expect(filePart.url).toContain("/..")
    }
  })

  test("serializes browser comments as rich metadata plus screenshot file parts", () => {
    const prompt: Prompt = [
      { type: "text", content: "fix this", start: 0, end: 8 },
      {
        type: "browser-comment",
        id: "bc_1",
        kind: "element",
        note: "Make this button larger",
        screenshot: { dataUrl: "data:image/png;base64,BBB", mime: "image/png", filename: "button.png" },
        rect: { x: 10, y: 20, width: 100, height: 40 },
        point: { x: 60, y: 40 },
        page: { url: "http://localhost:5173/", title: "Demo" },
        viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
        console: [{ level: "warning", text: "fixture warning", timestamp: 1 }],
        element: {
          tagName: "BUTTON",
          id: "cta",
          className: "primary",
          role: "button",
          text: "Start",
          attributes: { id: "cta", class: "primary" },
        },
        source: { fileName: "/repo/src/App.tsx", lineNumber: 12, columnNumber: 4, framework: "react-dev" },
        styles: { color: "rgb(0, 0, 0)", fontSize: "16px" },
        createdAt: 1,
      },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "fix this",
      messageID: "msg_browser",
      sessionID: "ses_browser",
      sessionDirectory: "/repo",
    })

    const browserText = result.requestParts.find(
      (part) => part.type === "text" && !!part.metadata?.ocoBrowserComment,
    )
    const batchText = result.requestParts.find(
      (part) => part.type === "text" && !!part.metadata?.ocoBrowserCommentBatch,
    )
    const screenshot = result.requestParts.find(
      (part) => part.type === "file" && part.filename === "button.png" && part.url === "data:image/png;base64,BBB",
    )

    expect(browserText).toBeDefined()
    expect(batchText).toBeDefined()
    expect(screenshot).toBeDefined()
    if (browserText?.type === "text" && screenshot?.type === "file") {
      const payload = JSON.parse(browserText.text)
      expect(payload.note).toBe("Make this button larger")
      expect(payload.source).toEqual({
        status: "available",
        confidence: "high",
        file: "/repo/src/App.tsx",
        line: 12,
        column: 4,
        framework: "react-dev",
      })
      expect(payload.image).toEqual({ partID: screenshot.id, filename: "button.png" })
      expect((browserText.metadata?.ocoBrowserComment as { id?: string }).id).toBe("bc_1")
    }
    if (batchText?.type === "text") {
      const payload = JSON.parse(batchText.text)
      expect(payload.console).toEqual([{ level: "warning", text: "fixture warning", count: 1 }])
    }
  })

  test("keeps normal image attachments unchanged when browser comments are present", () => {
    const result = buildRequestParts({
      prompt: [
        { type: "text", content: "fix this", start: 0, end: 8 },
        {
          type: "browser-comment",
          id: "bc_img_regression",
          kind: "area",
          note: "",
          screenshot: { dataUrl: "data:image/png;base64,BROWSER", mime: "image/png", filename: "area.png" },
          rect: { x: 1, y: 2, width: 3, height: 4 },
          point: { x: 2, y: 3 },
          page: { url: "http://localhost:3000/" },
          viewport: { width: 500, height: 400 },
          console: [],
          createdAt: 1,
        },
      ],
      context: [],
      images: [{ type: "image", id: "img_keep", filename: "drop.png", mime: "image/png", dataUrl: "data:image/png;base64,DROP" }],
      text: "fix this",
      messageID: "msg_browser_image",
      sessionID: "ses_browser_image",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts.some((part) => part.type === "file" && part.filename === "drop.png")).toBe(true)
    expect(result.requestParts.some((part) => part.type === "file" && part.filename === "area.png")).toBe(true)
  })
})
