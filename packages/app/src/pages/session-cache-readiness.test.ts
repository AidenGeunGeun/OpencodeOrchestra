import { describe, expect, test } from "bun:test"

describe("session page message readiness", () => {
  test("does not expose cached messages to the timeline until the cache is fresh", async () => {
    const source = await Bun.file(new URL("./session.tsx", import.meta.url)).text()

    expect(source).toContain("const cachedMessages = createMemo")
    expect(source).toContain('messageStale: false')
    expect(source).toContain('setStore("messageStale", untrack(currentMessageStale))')
    expect(source).toContain('if (store.messageKey === sessionKey() && store.messageStale) return false')
    expect(source).toContain('.then(() => {')
    expect(source).toContain('setStore("messageStale", false)')
    expect(source).toContain('.catch(() => undefined)')
    expect(source).toContain("return sync.session.history.ready(id)")
    expect(source).toContain("const messages = createMemo(() => (messagesReady() ? cachedMessages() : []))")
    expect(source).not.toContain("const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))")
  })
})
