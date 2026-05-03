import { describe, expect, test } from "bun:test"

describe("session page message readiness", () => {
  test("exposes same-session cached messages while stale metadata refreshes", async () => {
    const source = await Bun.file(new URL("./session.tsx", import.meta.url)).text()

    expect(source).toContain("const cachedMessages = createMemo")
    expect(source).toContain("const hasAnyCachedMessages = createMemo")
    expect(source).toContain("const hasSafeCachedMessages = createMemo")
    expect(source).toContain("if (sync.directory && sync.directory !== sdk.directory) return false")
    expect(source).toContain("if (session?.directory && session.directory !== sdk.directory) return false")
    expect(source).toContain('messageStale: false')
    expect(source).toContain('setStore("messageStale", untrack(currentMessageStale))')
    expect(source).toContain("if (hasAnyCachedMessages() && !hasSafeCachedMessages()) return false")
    expect(source).toContain('if (store.messageKey === sessionKey() && store.messageStale) return hasSafeCachedMessages()')
    expect(source).toContain('perfLog("session.messages.cache"')
    expect(source).toContain('refresh: "background"')
    expect(source).toContain('.then(() => {')
    expect(source).toContain('setStore("messageStale", false)')
    expect(source).toContain('.catch(() => undefined)')
    expect(source).toContain("return sync.session.history.ready(id)")
    expect(source).toContain("const messages = createMemo(() => (messagesReady() ? cachedMessages() : []))")
    expect(source).not.toContain("const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))")
  })

  test("uses an upstream-like first message page and labels active loads", async () => {
    const source = await Bun.file(new URL("../context/sync.tsx", import.meta.url)).text()

    expect(source).toContain("const messagePageSize = 50")
    expect(source).toContain('kind: "active"')
    expect(source).toContain('kind: "older-history"')
    expect(source).toContain('perfLog("session.messages.client"')
  })
})
