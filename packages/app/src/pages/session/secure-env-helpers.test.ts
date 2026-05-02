import { describe, expect, test } from "bun:test"
import {
  removeSecureEnvIDs,
  secureEnvBulkDeleteResult,
  selectAllSecureEnvVisible,
  selectedSecureEnvEntries,
  toggleSecureEnvSelection,
} from "./secure-env-helpers"

describe("Secure Env selection helpers", () => {
  const entries = [
    { id: "one", name: "ONE" },
    { id: "two", name: "TWO" },
    { id: "three", name: "THREE" },
  ]

  test("selects individual entries and all visible entries by id", () => {
    const oneSelected = toggleSecureEnvSelection(new Set<string>(), "one")
    expect([...oneSelected]).toEqual(["one"])

    const noneSelected = toggleSecureEnvSelection(oneSelected, "one")
    expect([...noneSelected]).toEqual([])

    expect([...selectAllSecureEnvVisible(entries)]).toEqual(["one", "two", "three"])
  })

  test("derives selected names without value material", () => {
    const selected = new Set(["one", "three", "missing"])
    expect(selectedSecureEnvEntries(entries, selected)).toEqual([
      { id: "one", name: "ONE" },
      { id: "three", name: "THREE" },
    ])
  })

  test("clears deleted ids from selection and reveal state", () => {
    const selected = new Set(["one", "two", "three"])
    const revealed = new Set(["two", "three"])

    expect([...removeSecureEnvIDs(selected, ["two"])]).toEqual(["one", "three"])
    expect([...removeSecureEnvIDs(revealed, ["two"])]).toEqual(["three"])
  })

  test("reports partial bulk delete outcomes without claiming full cleanup", () => {
    expect(secureEnvBulkDeleteResult(3, 0)).toEqual({ total: 3, deleted: 3, failed: 0, complete: true })
    expect(secureEnvBulkDeleteResult(3, 1)).toEqual({ total: 3, deleted: 2, failed: 1, complete: false })
  })
})
