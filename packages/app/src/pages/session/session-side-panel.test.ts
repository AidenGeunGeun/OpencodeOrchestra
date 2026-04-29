import { describe, expect, test } from "bun:test"

describe("SessionSidePanel Browser tab mounting", () => {
  test("keeps BrowserTab lazy until the browser tab is selected", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()

    expect(source).toContain("browserActivated: false")
    expect(source).toContain('const browserMounted = createMemo(() => store.browserActivated || activeTab() === "browser")')
    expect(source).toContain('if (activeTab() !== "browser" || store.browserActivated) return')
    expect(source).toContain("<Show when={browserMounted()}>")
    expect(source).toContain("<BrowserTab />")
  })
})
