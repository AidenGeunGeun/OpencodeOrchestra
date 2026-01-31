import { describe, expect, test, mock, beforeEach } from "bun:test"
import { ProjectStateReadTool, ProjectStateWriteTool, ProjectStateStorage } from "../../src/tool/project-state"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")
const STORAGE_PATH = path.join(SRC_ROOT, "storage/storage.ts")
const getStateFile = (root: string) => path.join(root, ".opencode", "project-state.json")

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

    test("read tool returns state for PM", async () => {
      mock.module(SESSION_PATH, () => ({
        Session: {
          get: mock(() => Promise.resolve({ id: "root", parentID: undefined })),
        },
      }))
      
      mock.module(STORAGE_PATH, () => ({
        Storage: {
          read: mock(() => Promise.reject({ name: "NotFoundError" })),
          write: mock(() => Promise.resolve()),
          NotFoundError: { isInstance: (e: any) => e.name === "NotFoundError" },
        },
      }))

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateReadTool.init()
          const result = await impl.execute({}, ctx)
          expect(result.output).toContain("objectives")
        },
      })
    })

    test("write tool updates state for PM", async () => {
      mock.module(SESSION_PATH, () => ({
        Session: {
          get: mock(() => Promise.resolve({ id: "root", parentID: undefined })),
        },
      }))

      mock.module(STORAGE_PATH, () => ({
        Storage: {
          read: mock(() => Promise.reject({ name: "NotFoundError" })),
          write: mock(() => Promise.resolve()),
          NotFoundError: { isInstance: (e: any) => e.name === "NotFoundError" },
        },
      }))

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const impl = await ProjectStateWriteTool.init()
          const result = await impl.execute({ objectives: ["win"] }, ctx)
          expect(result.output).toContain("Project state updated")
        },
      })
    })
  })
})
