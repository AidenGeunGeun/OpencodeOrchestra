import { describe, expect, test } from "bun:test"
import { RunChildSessionTracker, createWaitForChildrenTimeoutResult } from "./run-wait"

describe("run child session wait tracker", () => {
  test("waits for a persistent child and the post-handoff parent step", () => {
    const tracker = new RunChildSessionTracker("root", true)

    expect(tracker.observeSessionCreated({ id: "child", parentID: "root", agentID: "orchestrator" }, true)).toBe(true)

    tracker.observeSessionStatus("root", "idle")
    expect(tracker.shouldExit()).toBe(false)

    tracker.observeRootActivity("root")
    tracker.observeSessionStatus("child", "idle")
    expect(tracker.shouldExit()).toBe(false)

    tracker.observeSessionStatus("root", "busy")
    tracker.observeSessionStatus("root", "idle")
    expect(tracker.shouldExit()).toBe(true)
  })

  test("exits as soon as the root session idles when no persistent child exists", () => {
    const tracker = new RunChildSessionTracker("root", true)

    tracker.observeSessionStatus("root", "busy")
    expect(tracker.shouldExit()).toBe(false)

    tracker.observeSessionStatus("root", "idle")
    expect(tracker.shouldExit()).toBe(true)
  })

  test("timeout result is non-zero and surfaces unfinished child IDs", () => {
    const tracker = new RunChildSessionTracker("root", true)

    tracker.observeSessionCreated({ id: "child", parentID: "root", agentID: "orchestrator" }, true)

    const result = createWaitForChildrenTimeoutResult(tracker)

    expect(result.exitCode).toBe(1)
    expect(result.childSessionIDs).toEqual(["child"])
    expect(result.message).toContain("child")
  })
})
