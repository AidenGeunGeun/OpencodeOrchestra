import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { applyOptimisticAdd, applyOptimisticRemove, mergeOptimisticPage } from "./sync"

const userMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const textPart = (id: string, sessionID: string, messageID: string): Part => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text: id,
})

describe("sync optimistic reducers", () => {
  test("applyOptimisticAdd inserts message in sorted order and stores parts", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_2", sessionID)] },
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [textPart("prt_2", sessionID, "msg_1"), textPart("prt_1", sessionID, "msg_1")],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
  })

  test("applyOptimisticRemove removes message and part entries", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)] },
      part: {
        msg_1: [textPart("prt_1", sessionID, "msg_1")],
        msg_2: [textPart("prt_2", sessionID, "msg_2")],
      } as Record<string, Part[] | undefined>,
    }

    applyOptimisticRemove(draft, { sessionID, messageID: "msg_1" })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_2"])
    expect(draft.part.msg_1).toBeUndefined()
    expect(draft.part.msg_2).toHaveLength(1)
  })

  test("mergeOptimisticPage keeps pending optimistic messages visible", () => {
    const sessionID = "ses_1"
    const next = mergeOptimisticPage(
      {
        session: [userMessage("msg_1", sessionID), userMessage("msg_3", sessionID)],
        part: [
          { id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] },
          { id: "msg_3", part: [textPart("prt_3", sessionID, "msg_3")] },
        ],
        complete: true,
      },
      [{ message: userMessage("msg_2", sessionID), parts: [textPart("prt_2", sessionID, "msg_2")] }],
    )

    expect(next.session.map((x) => x.id)).toEqual(["msg_1", "msg_2", "msg_3"])
    expect(next.part.map((x) => x.id)).toEqual(["msg_1", "msg_2", "msg_3"])
    expect(next.confirmed).toEqual([])
  })

  test("mergeOptimisticPage reports confirmed optimistic messages", () => {
    const sessionID = "ses_1"
    const next = mergeOptimisticPage(
      {
        session: [userMessage("msg_1", sessionID)],
        part: [{ id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] }],
        complete: true,
      },
      [{ message: userMessage("msg_1", sessionID), parts: [textPart("prt_1", sessionID, "msg_1")] }],
    )

    expect(next.session.map((x) => x.id)).toEqual(["msg_1"])
    expect(next.part).toHaveLength(1)
    expect(next.confirmed).toEqual(["msg_1"])
  })

  test("mergeOptimisticPage preserves optimistic parts until server catches up", () => {
    const sessionID = "ses_1"
    const next = mergeOptimisticPage(
      {
        session: [userMessage("msg_1", sessionID)],
        part: [{ id: "msg_1", part: [] }],
        complete: true,
      },
      [{ message: userMessage("msg_1", sessionID), parts: [textPart("prt_1", sessionID, "msg_1")] }],
    )

    expect(next.session.map((x) => x.id)).toEqual(["msg_1"])
    expect(next.part[0]?.part.map((x) => x.id)).toEqual(["prt_1"])
    expect(next.confirmed).toEqual([])
  })
})
