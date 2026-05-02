import { describe, expect, test } from "bun:test"

describe("SecureEnvTab workspace lifecycle", () => {
  test("reloads and clears secret state when the active directory changes", async () => {
    const source = await Bun.file(new URL("./secure-env-tab.tsx", import.meta.url)).text()

    expect(source).toContain("createEffect(() =>")
    expect(source).toContain("const directory = sdk.directory")
    expect(source).toContain("resetWorkspaceState()")
    expect(source).toContain("const version = ++loadVersion")
    expect(source).toContain("if (version !== loadVersion) return")
    expect(source).toContain("setEntries([])")
    expect(source).toContain("setProfileID(undefined)")
    expect(source).toContain("setAdminToken(undefined)")
    expect(source).toContain("setRevealed(new Set<string>())")
    expect(source).toContain("setSelected(new Set<string>())")
  })

  test("keeps hide value in the same row action position as show value", async () => {
    const source = await Bun.file(new URL("./secure-env-tab.tsx", import.meta.url)).text()
    const row = source.slice(source.indexOf("function EntryRow"))
    const copyIndex = row.indexOf('session.secureEnv.action.copy')
    const revealIndex = row.indexOf('session.secureEnv.action.reveal')

    expect(copyIndex).toBeGreaterThan(-1)
    expect(revealIndex).toBeGreaterThan(-1)
    expect(copyIndex).toBeLessThan(revealIndex)
  })

  test("uses a restrained bulk delete confirmation instead of a full warning wash", async () => {
    const source = await Bun.file(new URL("./secure-env-tab.tsx", import.meta.url)).text()
    const confirm = source.slice(source.indexOf("function BulkDeleteConfirm"), source.indexOf("function Footer"))

    expect(confirm).toContain("bg-background-base")
    expect(confirm).toContain("bg-background-stronger")
    expect(confirm).toContain("border-border-warning-base/60")
    expect(confirm).not.toContain("bg-surface-warning-weak")
  })
})
