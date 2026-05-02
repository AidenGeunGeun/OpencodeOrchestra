import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { directoryAcceptKey, permissionAutoAccepts, sessionAcceptKey } from "./permission-auto-accept-rules"

const KV_KEY = "permission_auto_accept"

export const { use: usePermissionAutoAccept, provider: PermissionAutoAcceptProvider } = createSimpleContext({
  name: "PermissionAutoAccept",
  init: () => {
    const kv = useKV()
    const sdk = useSDK()
    const sync = useSync()
    const responded = new Map<string, number>()

    const directory = createMemo(() => sync.data.path.directory || undefined)
    const autoAccept = createMemo<Record<string, boolean>>(() => kv.get(KV_KEY, {}))

    function setAutoAccept(next: Record<string, boolean>) {
      kv.set(KV_KEY, next)
    }

    function isDirectoryAutoAccepting(targetDirectory = directory()) {
      if (!targetDirectory) return false
      return autoAccept()[directoryAcceptKey(targetDirectory)] ?? false
    }

    function isAutoAccepting(sessionID: string, targetDirectory = directory()) {
      if (!targetDirectory) return false
      return permissionAutoAccepts(autoAccept(), sync.data.session, { sessionID }, targetDirectory)
    }

    function shouldAutoAccept(request: PermissionRequest, targetDirectory = directory()) {
      if (!targetDirectory) return false
      return permissionAutoAccepts(autoAccept(), sync.data.session, request, targetDirectory)
    }

    function hasCurrentDirectoryAutoAccept(targetDirectory: string) {
      const state = autoAccept()
      if (state[directoryAcceptKey(targetDirectory)] === true) return true
      const prefix = sessionAcceptKey("", targetDirectory)
      return Object.entries(state).some(([key, value]) => value === true && key.startsWith(prefix))
    }

    function markResponded(id: string) {
      const now = Date.now()
      responded.delete(id)
      responded.set(id, now)
      for (const [key, ts] of responded) {
        if (responded.size <= 1000 && now - ts < 60 * 60 * 1000) break
        responded.delete(key)
      }
    }

    function replyOnce(request: PermissionRequest) {
      if (responded.has(request.id)) return
      markResponded(request.id)
      sdk.client.permission.reply({ requestID: request.id, reply: "once" }).catch(() => responded.delete(request.id))
    }

    function flushPending(targetDirectory = directory()) {
      if (!targetDirectory) return
      for (const requests of Object.values(sync.data.permission)) {
        for (const request of requests) {
          if (shouldAutoAccept(request, targetDirectory)) replyOnce(request)
        }
      }
      sdk.client.permission
        .list()
        .then((x) => {
          for (const request of x.data ?? []) {
            if (shouldAutoAccept(request, targetDirectory)) replyOnce(request)
          }
        })
        .catch(() => undefined)
    }

    createEffect(() => {
      const targetDirectory = directory()
      const enabled = targetDirectory ? hasCurrentDirectoryAutoAccept(targetDirectory) : false
      Object.values(sync.data.permission).reduce((count, requests) => count + requests.length, 0)
      sync.data.session.map((session) => `${session.id}:${session.parentID ?? ""}`).join("|")
      if (!targetDirectory || !enabled) return
      flushPending(targetDirectory)
    })

    const off = sdk.event.on("permission.asked", (event) => {
      const request = event.properties
      if (shouldAutoAccept(request)) replyOnce(request)
    })
    onCleanup(off)

    return {
      directory,
      isAutoAccepting,
      isDirectoryAutoAccepting,
      toggleSession(sessionID: string, targetDirectory = directory()) {
        if (!targetDirectory) return
        const next = { ...autoAccept() }
        next[sessionAcceptKey(sessionID, targetDirectory)] = !isAutoAccepting(sessionID, targetDirectory)
        delete next[sessionID]
        setAutoAccept(next)
        if (next[sessionAcceptKey(sessionID, targetDirectory)]) flushPending()
      },
      toggleDirectory(targetDirectory = directory()) {
        if (!targetDirectory) return
        const key = directoryAcceptKey(targetDirectory)
        const next = { ...autoAccept(), [key]: !isDirectoryAutoAccepting(targetDirectory) }
        setAutoAccept(next)
        if (next[key]) flushPending()
      },
    }
  },
})
