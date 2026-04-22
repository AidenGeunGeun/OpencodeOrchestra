import type { FilePart, ToolPart } from "@opencode-ai/sdk/v2"

const emptyFiles: FilePart[] = []

export function displayAttachmentPath(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "file:") return url
    const pathname = decodeURIComponent(parsed.pathname)
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    const value = url.startsWith("file://") ? url.slice("file://".length) : url
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
}

export function generatedImageMissingText(file: Pick<FilePart, "url">) {
  return `Generated image not found: ${displayAttachmentPath(file.url)}`
}

export function generatedToolImageAttachments(part: ToolPart, enabled?: boolean) {
  if (!enabled) return emptyFiles
  if (part.tool !== "image_generation") return emptyFiles
  if (part.state.status !== "completed") return emptyFiles
  const attachments = part.state.attachments ?? emptyFiles
  return attachments.filter((file) => file.mime.startsWith("image/"))
}
