import { describe, expect, test, mock, beforeEach } from "bun:test"
import { FinishTaskTool } from "../../src/tool/finish-task"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

const SRC_ROOT = path.resolve(__dirname, "../../src")
const SESSION_PATH = path.join(SRC_ROOT, "session/index.ts")

const ctx = {
  sessionID: "child-123",
  messageID: "test-msg",
  callID: "",
  agent: "orchestrator",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("tool.finish-task", () => {
  beforeEach(() => {
    mock.restore()
  })

  test("validates required parameters", async () => {
    const impl = await FinishTaskTool.init()
    const result = impl.parameters.safeParse({
      summary: "Task done",
      status: "completed",
    })
    expect(result.success).toBe(true)
  })

  test("rejects invalid status", async () => {
    const impl = await FinishTaskTool.init()
    const result = impl.parameters.safeParse({
      summary: "Task done",
      status: "invalid_status",
    })
    expect(result.success).toBe(false)
  })

  test("throws when session not found", async () => {
    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock(() => Promise.resolve(undefined)),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await FinishTaskTool.init()
        await expect(impl.execute({ summary: "Done", status: "completed" }, ctx)).rejects.toThrow("Cannot find current session")
      },
    })
  })

  test("throws when no parentID (not a child session)", async () => {
    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock(() => Promise.resolve({ id: "session-123", parentID: undefined })),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await FinishTaskTool.init()
        await expect(impl.execute({ summary: "Done", status: "completed" }, ctx)).rejects.toThrow(
          "finish_task can only be called from a child session",
        )
      },
    })
  })

  test("returns correct output and metadata", async () => {
    mock.module(SESSION_PATH, () => ({
      Session: {
        get: mock(() => Promise.resolve({ id: "child-123", parentID: "parent-456" })),
      },
    }))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const impl = await FinishTaskTool.init()
        const result = await impl.execute(
          {
            summary: "Task completed successfully",
            status: "completed",
            learnings: ["Learning 1"],
          },
          ctx,
        )

        expect(result.output).toContain("Task completed")
        expect(result.output).toContain("Summary: Task completed successfully")
        expect(result.metadata).toEqual({
          parentSessionID: "parent-456",
          childSessionID: "child-123",
          status: "completed",
          summary: "Task completed successfully",
          learnings: ["Learning 1"],
        })
      },
    })
  })
})
