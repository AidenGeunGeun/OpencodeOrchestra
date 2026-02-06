import { describe, expect, test, mock, beforeEach } from "bun:test"
import { ProjectStateReadTool, ProjectStateWriteTool, ProjectStateStorage } from "../../src/tool/project-state"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const getStateFile = (root: string) => path.join(root, ".opencode", "project-state.json")

function mockPmSession() {
  mock.module(SESSION_PATH, () => ({
    Session: {
      get: mock(() => Promise.resolve({ id: "root", parentID: undefined })),
    },
  }))
}

const ctx = {
  sessionID: "test-session",
  messageID: "test-msg",
  callID: "",
  agent: "pm",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("tool.project-state", () => {
  beforeEach(() => {
    mock.restore()
  })

  describe("ProjectStateStorage", () => {
    test("read returns empty state on NotFoundError", async () => {
      await using tmp = await tmpdir()
      const state = await ProjectStateStorage.read(tmp.path)
      expect(state).toEqual({
        objectives: [],
        decisions: [],
        learnings: [],
        todos: [],
      })
    })

    test("write merges partial state", async () => {
      const existing = {
        objectives: ["old"],
        decisions: [],
        learnings: [],
        todos: [],
      }
      await using tmp = await tmpdir()
      const stateFile = getStateFile(tmp.path)
      await fs.mkdir(path.dirname(stateFile), { recursive: true })
      await Bun.write(stateFile, JSON.stringify(existing, null, 2))

      const updated = await ProjectStateStorage.write(tmp.path, { objectives: ["new"] })
      expect(updated.objectives).toEqual(["new"])
      const saved = await Bun.file(stateFile).json()
      expect(saved.objectives).toEqual(["new"])
      expect(saved.lastUpdated).toBeDefined()
    })
  })

  describe("Tools", () => {
    test("read tool throws for non-PM", async () => {
      mock.module(SESSION_PATH, () => ({
        Session: {
          get: mock(() => Promise.resolve({ id: "child", parentID: "parent" })),
        },
      }))

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateReadTool.init()
          const nonPmCtx = { ...ctx, agent: "orchestrator" }
          await expect(impl.execute({}, nonPmCtx)).rejects.toThrow("PM-only")
        },
      })
    })

    test("read tool returns compact full state for PM", async () => {
      mockPmSession()

      const existing = {
        objectives: ["ship orchestrator"],
        decisions: [{ decision: "use bun", rationale: "runtime parity", timestamp: "2026-01-01T00:00:00.000Z" }],
        learnings: [{ topic: "tools", insight: "project state is PM-only" }],
        todos: [{ id: "1", task: "add tests", status: "pending", priority: "high" }],
      }

      await using tmp = await tmpdir()
      const stateFile = getStateFile(tmp.path)
      await fs.mkdir(path.dirname(stateFile), { recursive: true })
      await Bun.write(stateFile, JSON.stringify(existing, null, 2))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateReadTool.init()
          const result = await impl.execute({}, ctx)
          expect(result.output).toBe(JSON.stringify(existing))
          expect(result.output).not.toContain("\n")
        },
      })
    })

    test("read tool supports section filtering", async () => {
      mockPmSession()

      const existing = {
        objectives: ["ship orchestrator"],
        decisions: [{ decision: "use bun", rationale: "runtime parity", timestamp: "2026-01-01T00:00:00.000Z" }],
        learnings: [{ topic: "tools", insight: "project state is PM-only" }],
        todos: [{ id: "1", task: "add tests", status: "pending", priority: "high" }],
      }

      await using tmp = await tmpdir()
      const stateFile = getStateFile(tmp.path)
      await fs.mkdir(path.dirname(stateFile), { recursive: true })
      await Bun.write(stateFile, JSON.stringify(existing, null, 2))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateReadTool.init()

          const todosOnly = await impl.execute({ section: "todos" }, ctx)
          expect(JSON.parse(todosOnly.output)).toEqual({ todos: existing.todos })

          const multi = await impl.execute({ section: ["todos", "objectives"] }, ctx)
          expect(JSON.parse(multi.output)).toEqual({ todos: existing.todos, objectives: existing.objectives })
        },
      })
    })

    test("write tool appends add* fields and returns short confirmation", async () => {
      mockPmSession()

      const existing = {
        objectives: ["existing objective"],
        decisions: [{ decision: "old decision", rationale: "old rationale", timestamp: "2025-01-01T00:00:00.000Z" }],
        learnings: [{ topic: "old", insight: "old insight" }],
        todos: [{ id: "old", task: "old task", status: "pending", priority: "medium" }],
      }

      await using tmp = await tmpdir()
      const stateFile = getStateFile(tmp.path)
      await fs.mkdir(path.dirname(stateFile), { recursive: true })
      await Bun.write(stateFile, JSON.stringify(existing, null, 2))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateWriteTool.init()
          const result = await impl.execute(
            {
              addDecisions: [{ decision: "new decision", rationale: "new rationale", timestamp: "2026-01-01T00:00:00.000Z" }],
              addLearnings: [{ topic: "new", insight: "new insight" }],
              addTodos: [{ id: "new", task: "new task", status: "in_progress", priority: "high" }],
            },
            ctx,
          )

          expect(result.output).toBe("Project state updated successfully.")

          const saved = await Bun.file(stateFile).json()
          expect(saved.decisions).toEqual([
            ...existing.decisions,
            { decision: "new decision", rationale: "new rationale", timestamp: "2026-01-01T00:00:00.000Z" },
          ])
          expect(saved.learnings).toEqual([...existing.learnings, { topic: "new", insight: "new insight" }])
          expect(saved.todos).toEqual([
            ...existing.todos,
            { id: "new", task: "new task", status: "in_progress", priority: "high" },
          ])

          const fileText = await Bun.file(stateFile).text()
          expect(fileText).toContain('\n  "objectives"')
        },
      })
    })

    test("write tool full-replace fields still work", async () => {
      mockPmSession()

      await using tmp = await tmpdir()
      const stateFile = getStateFile(tmp.path)
      await fs.mkdir(path.dirname(stateFile), { recursive: true })
      await Bun.write(stateFile, JSON.stringify({ todos: [{ id: "old", task: "keep", status: "pending", priority: "low" }] }, null, 2))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateWriteTool.init()
          await impl.execute({ todos: [{ id: "new", task: "replace", status: "completed", priority: "high" }] }, ctx)

          const saved = await Bun.file(stateFile).json()
          expect(saved.todos).toEqual([{ id: "new", task: "replace", status: "completed", priority: "high" }])
        },
      })
    })
  })
})
