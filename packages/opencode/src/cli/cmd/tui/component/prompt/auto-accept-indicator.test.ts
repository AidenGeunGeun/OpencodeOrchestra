import { describe, expect, test } from "bun:test"

describe("TUI prompt auto-accept indicator", () => {
  test("renders auto-accept state in the visible prompt metadata row", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

    expect(source).toContain('import { usePermissionAutoAccept } from "../../context/permission-auto-accept"')
    expect(source).toContain("const permissionAutoAccept = usePermissionAutoAccept()")
    expect(source).toContain("const autoAccepting = createMemo")
    expect(source).toContain("permissionAutoAccept.isAutoAccepting(props.sessionID, directory)")
    expect(source).toContain("permissionAutoAccept.isDirectoryAutoAccepting(directory)")
    expect(source).toContain("Auto-accept ON")
  })
})
