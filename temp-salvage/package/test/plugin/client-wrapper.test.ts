import { describe, expect, test, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { wrapClientForDepthAwareness } from "../../src/plugin/client-wrapper"

Log.init({ print: false })

/**
 * Creates a mock SDK client for testing.
 * The mock client's session.get() returns whatever parentID we configure.
 */
function createMockClient(sessions: Record<string, { parentID?: string }>) {
  return {
    session: {
      get: async (opts: { path: { id: string } }) => {
        const sessionID = opts.path.id
        const sessionData = sessions[sessionID]
        if (!sessionData) {
          return { data: undefined, error: { status: 404 } }
        }
        return {
          data: {
            id: sessionID,
            parentID: sessionData.parentID,
            // Other session fields would go here
          },
        }
      },
    },
    // Add other client properties as needed
  } as any
}

describe("plugin.client-wrapper", () => {
  describe("wrapClientForDepthAwareness", () => {
    test("hides parentID for depth 0 sessions (PM)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create a PM session (no parent, depth 0)
          const pmSession = await Session.create({})
          
          // Create mock client that returns the PM session with no parentID
          const mockClient = createMockClient({
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: pmSession.id } })
          
          // PM session has no parentID anyway, should remain undefined
          expect(result.data?.parentID).toBeUndefined()
        },
      })
    })

    test("hides parentID for depth 1 sessions (Orchestrator)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create PM session (depth 0)
          const pmSession = await Session.create({})
          
          // Create Orchestrator session (depth 1)
          const orchSession = await Session.create({ parentID: pmSession.id })
          
          // Create mock client that returns the Orchestrator session with parentID
          const mockClient = createMockClient({
            [orchSession.id]: { parentID: pmSession.id },
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: orchSession.id } })
          
          // Orchestrator session should have parentID HIDDEN (for DCP to apply pruning)
          expect(result.data?.parentID).toBeUndefined()
        },
      })
    })

    test("keeps parentID for depth 2 sessions (Subagent)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create PM session (depth 0)
          const pmSession = await Session.create({})
          
          // Create Orchestrator session (depth 1)
          const orchSession = await Session.create({ parentID: pmSession.id })
          
          // Create Subagent session (depth 2)
          const subSession = await Session.create({ parentID: orchSession.id })
          
          // Create mock client that returns the Subagent session with parentID
          const mockClient = createMockClient({
            [subSession.id]: { parentID: orchSession.id },
            [orchSession.id]: { parentID: pmSession.id },
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: subSession.id } })
          
          // Subagent session should have parentID KEPT (for DCP to skip pruning)
          expect(result.data?.parentID).toBe(orchSession.id)
        },
      })
    })

    test("keeps parentID for depth 3+ sessions (nested subagents)", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create chain: PM -> Orch -> Sub1 -> Sub2 (depth 3)
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          const sub1Session = await Session.create({ parentID: orchSession.id })
          const sub2Session = await Session.create({ parentID: sub1Session.id })
          
          // Create mock client
          const mockClient = createMockClient({
            [sub2Session.id]: { parentID: sub1Session.id },
            [sub1Session.id]: { parentID: orchSession.id },
            [orchSession.id]: { parentID: pmSession.id },
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: sub2Session.id } })
          
          // Nested subagent should have parentID KEPT
          expect(result.data?.parentID).toBe(sub1Session.id)
        },
      })
    })

    test("passes through other session properties unchanged", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          
          // Create mock client with additional properties
          const mockClient = {
            session: {
              get: async (opts: { path: { id: string } }) => ({
                data: {
                  id: orchSession.id,
                  parentID: pmSession.id,
                  title: "Test Session",
                },
              }),
            },
          } as any
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: orchSession.id } })
          
          // parentID should be hidden
          expect(result.data?.parentID).toBeUndefined()
          // Other properties should be preserved
          expect(result.data?.title).toBe("Test Session")
        },
      })
    })

    test("handles missing sessionID gracefully", async () => {
      const mockClient = createMockClient({})
      const wrappedClient = wrapClientForDepthAwareness(mockClient)
      
      // Call without proper path
      const result = await wrappedClient.session.get({ path: { id: "" } } as any)
      
      // Should not crash, return original result
      expect(result).toBeDefined()
    })

    test("handles session.get errors gracefully", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          
          // Create mock client that returns an error
          const mockClient = {
            session: {
              get: async () => ({
                data: { id: pmSession.id, parentID: "some-parent" },
              }),
            },
          } as any
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          
          // Even if depth calculation fails, should return original result
          const result = await wrappedClient.session.get({ path: { id: "nonexistent" } })
          expect(result).toBeDefined()
        },
      })
    })
  })

  describe("DCP integration behavior", () => {
    test("DCP sees no parentID for PM session → applies pruning", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          
          const mockClient = createMockClient({
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: pmSession.id } })
          
          // DCP's isSubAgentSession() checks: !!result.data?.parentID
          const dcpWouldSkipPruning = !!result.data?.parentID
          expect(dcpWouldSkipPruning).toBe(false) // DCP should apply pruning
        },
      })
    })

    test("DCP sees no parentID for Orchestrator session → applies pruning", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          
          const mockClient = createMockClient({
            [orchSession.id]: { parentID: pmSession.id },
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: orchSession.id } })
          
          // DCP's isSubAgentSession() checks: !!result.data?.parentID
          const dcpWouldSkipPruning = !!result.data?.parentID
          expect(dcpWouldSkipPruning).toBe(false) // DCP should apply pruning
        },
      })
    })

    test("DCP sees parentID for Subagent session → skips pruning", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pmSession = await Session.create({})
          const orchSession = await Session.create({ parentID: pmSession.id })
          const subSession = await Session.create({ parentID: orchSession.id })
          
          const mockClient = createMockClient({
            [subSession.id]: { parentID: orchSession.id },
            [orchSession.id]: { parentID: pmSession.id },
            [pmSession.id]: { parentID: undefined },
          })
          
          const wrappedClient = wrapClientForDepthAwareness(mockClient)
          const result = await wrappedClient.session.get({ path: { id: subSession.id } })
          
          // DCP's isSubAgentSession() checks: !!result.data?.parentID
          const dcpWouldSkipPruning = !!result.data?.parentID
          expect(dcpWouldSkipPruning).toBe(true) // DCP should skip pruning
        },
      })
    })
  })
})
