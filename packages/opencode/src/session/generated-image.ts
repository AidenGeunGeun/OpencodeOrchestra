import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import { Log } from "@/util/log"
import type { MessageV2 } from "./message-v2"

export namespace GeneratedImage {
  const log = Log.create({ service: "session.generated-image" })

  export function sanitizeSegment(value: string) {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_")
    return sanitized.length > 0 ? sanitized : "_"
  }

  export function relativeDirectory(sessionID: string) {
    return path.posix.join(".oco", "generated", sanitizeSegment(sessionID))
  }

  export function filename(callID: string) {
    return sanitizeSegment(callID) + ".png"
  }

  export function resolvePath(input: { cwd: string; sessionID: string; callID: string }) {
    const root = path.resolve(input.cwd, ".oco", "generated")
    const sessionDirectory = path.resolve(root, sanitizeSegment(input.sessionID))
    const outputPath = path.resolve(sessionDirectory, filename(input.callID))
    const safeRoot = root.endsWith(path.sep) ? root : root + path.sep

    if (!outputPath.startsWith(safeRoot)) {
      throw new Error(`generated image path escaped root: ${outputPath}`)
    }

    return {
      root,
      sessionDirectory,
      outputPath,
    }
  }

  export function instruction(sessionID: string) {
    return [
      "<system-reminder>",
      `Generated images are saved to \`${relativeDirectory(sessionID)}/\` as \`.png\` files.`,
      "If you need to reference an image you generated, read the saved path; do not regenerate.",
      "If asked to use a generated image elsewhere, copy it; do not move or delete the original unless the user explicitly asks.",
      "</system-reminder>",
    ].join("\n")
  }

  export function attachmentPath(attachments: MessageV2.FilePart[] | undefined) {
    for (const attachment of attachments ?? []) {
      if (attachment.mime !== "image/png") continue
      if (!attachment.url.startsWith("file://")) continue
      try {
        return fileURLToPath(attachment.url)
      } catch {
        continue
      }
    }
  }

  export function replaceOutputWithReference(output: string, filePath: string) {
    const reference = `<see attached file: ${filePath}>`
    const fallback = JSON.stringify({ result: reference })

    try {
      const parsed = JSON.parse(output)
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { result?: unknown }).result !== "string") {
        return fallback
      }
      return JSON.stringify({
        ...(parsed as Record<string, unknown>),
        result: reference,
      })
    } catch {
      return fallback
    }
  }

  export async function save(input: { cwd: string; sessionID: string; callID: string; output: string }) {
    const { outputPath, sessionDirectory } = resolvePath(input)
    const decoded = decodeOutput(input.output)

    if (!decoded.ok) {
      log.warn("invalid image_generation payload", {
        callID: input.callID,
        outputPath,
        reason: decoded.reason,
      })
      return
    }

    try {
      await fs.mkdir(sessionDirectory, { recursive: true })
      await Bun.write(outputPath, decoded.bytes)
      return {
        path: outputPath,
        filename: filename(input.callID),
      }
    } catch (error) {
      log.warn("failed to save generated image", {
        callID: input.callID,
        outputPath,
        error,
      })
    }
  }

  function decodeOutput(output: string): { ok: true; bytes: Uint8Array } | { ok: false; reason: string } {
    const payload = extractPayload(output).trim()

    if (payload.startsWith("data:")) {
      return { ok: false, reason: "data URLs are not supported" }
    }

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 !== 0) {
      return { ok: false, reason: "payload is not standard base64" }
    }

    const bytes = Buffer.from(payload, "base64")
    if (bytes.length === 0 || bytes.toString("base64") !== payload) {
      return { ok: false, reason: "payload failed to decode" }
    }

    return { ok: true, bytes }
  }

  function extractPayload(output: string) {
    try {
      const parsed = JSON.parse(output)
      if (parsed && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
        return (parsed as { result: string }).result
      }
    } catch {
      // Ignore non-JSON output and treat it as the raw payload.
    }

    return output
  }
}
