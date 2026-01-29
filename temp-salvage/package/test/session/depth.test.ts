import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { calculateDepth, shouldApplyPruning } from "../../src/session/depth"

Log.init({ print: false })

describe("session.depth", () => {
  describe("calculateDepth", () => {
    test("returns 0 for session without parentID (PM session)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create a root session (no parent) - simulates PM
          const pmSession = await Session.create({})
          
          const depth = await calculateDepth(pmSession.id)
          expect(depth).toBe(0)
        },
      })
    })

    test("returns 1 for session with one parent (Orchestrator session)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create PM session (depth 0)
          const pmSession = await Session.create({})
          
          // Create Orchestrator session with PM as parent (depth 1)
          const orchestratorSession = await Session.create({
            parentID: pmSession.id,
          })
          
          const depth = await calculateDepth(orchestratorSession.id)
          expect(depth).toBe(1)
        },
      })
    })

    test("returns 2 for session with two parents (Subagent session)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create PM session (depth 0)
          const pmSession = await Session.create({})
          
          // Create Orchestrator session (depth 1)
          const orchestratorSession = await Session.create({
            parentID: pmSession.id,
          })
          
          // Create Subagent session (depth 2)
          const subagentSession = await Session.create({
            parentID: orchestratorSession.id,
          })
          
          const depth = await calculateDepth(subagentSession.id)
          expect(depth).toBe(2)
        },
      })
    })

    test("returns 3+ for deeply nested sessions", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create chain: PM -> Orch -> Sub1 -> Sub2 (depth 3)
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          const sub1Session = await Session.create({ parentID: orchSession.id })
          const sub2Session = await Session.create({ parentID: sub1Session.id })
          
          const depth = await calculateDepth(sub2Session.id)
          expect(depth).toBe(3)
        },
      })
    })
  })

  describe("shouldApplyPruning", () => {
    test("returns true for depth 0 (PM)", () => {
      expect(shouldApplyPruning(0)).toBe(true)
    })

    test("returns true for depth 1 (Orchestrator)", () => {
      expect(shouldApplyPruning(1)).toBe(true)
    })

    test("returns false for depth 2 (Subagent)", () => {
      expect(shouldApplyPruning(2)).toBe(false)
    })

    test("returns false for depth 3+ (Nested subagent)", () => {
      expect(shouldApplyPruning(3)).toBe(false)
      expect(shouldApplyPruning(5)).toBe(false)
      expect(shouldApplyPruning(10)).toBe(false)
    })
  })

  describe("integration: calculateDepth + shouldApplyPruning", () => {
    test("PM session should have pruning applied", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          
          const depth = await calculateDepth(pmSession.id)
          expect(shouldApplyPruning(depth)).toBe(true)
        },
      })
    })

    test("Orchestrator session should have pruning applied", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          
          const depth = await calculateDepth(orchSession.id)
          expect(shouldApplyPruning(depth)).toBe(true)
        },
      })
    })

    test("Subagent session should NOT have pruning applied", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          const subSession = await Session.create({ parentID: orchSession.id })
          
          const depth = await calculateDepth(subSession.id)
          expect(shouldApplyPruning(depth)).toBe(false)
        },
      })
    })
  })
})
