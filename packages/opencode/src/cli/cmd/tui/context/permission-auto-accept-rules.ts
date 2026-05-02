import { base64Encode } from "@opencode-ai/util/encode"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2"

export function sessionAcceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const sessionKey = sessionAcceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return autoAccept[sessionKey] ?? autoAccept[sessionID] ?? (directoryKey ? autoAccept[directoryKey] : undefined)
}

function sessionLineage(sessions: Pick<Session, "id" | "parentID">[], sessionID: string) {
  const parent = sessions.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function permissionAutoAccepts(
  autoAccept: Record<string, boolean>,
  sessions: Pick<Session, "id" | "parentID">[],
  permission: Pick<PermissionRequest, "sessionID">,
  directory?: string,
) {
  const value = sessionLineage(sessions, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
