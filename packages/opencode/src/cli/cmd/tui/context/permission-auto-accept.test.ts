import { describe, expect, test } from "bun:test"
import {
  directoryAcceptKey,
  permissionAutoAccepts,
  sessionAcceptKey,
} from "./permission-auto-accept-rules"

describe("TUI permission auto-accept helpers", () => {
  const directory = "/tmp/oco-project"
  const sessions = [
    { id: "parent" },
    { id: "child", parentID: "parent" },
    { id: "other" },
  ]

  test("accepts permissions for an explicitly enabled session", () => {
    const autoAccept = { [sessionAcceptKey("parent", directory)]: true }

    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "parent" }, directory)).toBe(true)
    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "other" }, directory)).toBe(false)
  })

  test("inherits session auto-accept from parent sessions", () => {
    const autoAccept = { [sessionAcceptKey("parent", directory)]: true }

    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "child" }, directory)).toBe(true)
  })

  test("scopes auto-accept to the current directory", () => {
    const autoAccept = { [sessionAcceptKey("parent", directory)]: true }

    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "parent" }, "/tmp/other-project")).toBe(false)
  })

  test("allows directory-wide auto-accept", () => {
    const autoAccept = { [directoryAcceptKey(directory)]: true }

    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "other" }, directory)).toBe(true)
  })

  test("session disable overrides directory-wide enable", () => {
    const autoAccept = {
      [directoryAcceptKey(directory)]: true,
      [sessionAcceptKey("other", directory)]: false,
    }

    expect(permissionAutoAccepts(autoAccept, sessions, { sessionID: "other" }, directory)).toBe(false)
  })
})
