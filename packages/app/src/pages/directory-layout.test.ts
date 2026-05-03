import { describe, expect, test } from "bun:test"
import { routeResolvedDirectory } from "./directory-layout-helpers"

describe("routeResolvedDirectory", () => {
  test("does not expose a stale provider directory during route changes", () => {
    const state = { resolved: "/old", resolvedRoute: "old" }

    expect(routeResolvedDirectory(state, "new")).toBe("")
  })

  test("exposes the resolved directory only for its route", () => {
    const state = { resolved: "/project", resolvedRoute: "project" }

    expect(routeResolvedDirectory(state, "project")).toBe("/project")
  })
})
