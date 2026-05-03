import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { OrchestratorCompletion } from "../../src/session/orchestrator-completion"
import { SessionStatus } from "../../src/session/status"
import { HandoffToPMTool } from "../../src/tool/handoff-to-pm"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

const ctx = (sessionID: string) => ({
  sessionID,
  messageID: Identifier.ascending("message"),
  callID: "",
  agent: "orchestrator",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
})

async function createParentUserMessage(sessionID: string) {
  const message: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    tools: {},
  }
  await Session.updateMessage(message)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: message.id,
    type: "text",
    text: "delegate to orchestrator",
  })
  return message
}

async function createOrchestratorPair() {
  const parent = await Session.create({ title: "PM" })
  await createParentUserMessage(parent.id)
  SessionStatus.set(parent.id, { type: "busy" })
  const child = await Session.create({ parentID: parent.id, agentID: "orchestrator", title: "Orchestrator" })
  return { parent, child }
}

async function parentHandoffMessages(parentID: string) {
  const messages = await Session.messages({ sessionID: parentID })
  return messages.filter((message) =>
    message.parts.some(
      (part) => part.type === "text" && part.synthetic === true && part.text.includes("<orchestrator-handoff"),
    ),
  )
}

describe("tool.handoff-to-pm", () => {
  test("is available to Orchestrators but not other agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const orchestrator = await Agent.get("orchestrator")
        const investigator = await Agent.get("investigator")
        const model = { providerID: "test", modelID: "test" }
        const orchestratorTools = await ToolRegistry.tools(model, orchestrator).then((tools) => tools.map((tool) => tool.id))
        const investigatorTools = await ToolRegistry.tools(model, investigator).then((tools) => tools.map((tool) => tool.id))

        expect(orchestratorTools).toContain("handoff_to_pm")
        expect(orchestratorTools).not.toContain("finish_task")
        expect(investigatorTools).not.toContain("handoff_to_pm")
        expect(orchestrator.permission).toEqual(
          expect.arrayContaining([expect.objectContaining({ permission: "handoff_to_pm", action: "allow" })]),
        )
      },
    })
  }, 15000)

  test("appends one PM steering message and records native completion state", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, child } = await createOrchestratorPair()
        const impl = await HandoffToPMTool.init()

        const result = await impl.execute(
          {
            status: "completed",
            summary: "Implemented the spec",
            learnings: ["No historic repair needed"],
          },
          ctx(child.id),
        )

        const handoffs = await parentHandoffMessages(parent.id)
        const state = await OrchestratorCompletion.getByChild(child.id)

        expect(handoffs).toHaveLength(1)
        expect(handoffs[0].parts[0]).toMatchObject({ synthetic: true })
        expect((handoffs[0].parts[0] as MessageV2.TextPart).text).toContain('status="completed"')
        expect((handoffs[0].parts[0] as MessageV2.TextPart).text).toContain("Implemented the spec")
        expect((handoffs[0].parts[0] as MessageV2.TextPart).text).toContain("No historic repair needed")
        expect(state).toMatchObject({
          childSessionID: child.id,
          parentSessionID: parent.id,
          status: "completed",
          summary: "Implemented the spec",
          messageID: handoffs[0].info.id,
        })
        expect(result.metadata).toMatchObject({ duplicate: false, messageID: handoffs[0].info.id })
      },
    })
  })

  test("is idempotent across repeated handoff calls", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, child } = await createOrchestratorPair()
        const impl = await HandoffToPMTool.init()

        const first = await impl.execute({ status: "failed", summary: "First result" }, ctx(child.id))
        const second = await impl.execute({ status: "completed", summary: "Second result" }, ctx(child.id))
        const handoffs = await parentHandoffMessages(parent.id)
        const state = await OrchestratorCompletion.getByChild(child.id)

        expect(handoffs).toHaveLength(1)
        expect(first.metadata.messageID).toBe(second.metadata.messageID)
        expect(second.metadata.duplicate).toBe(true)
        expect(state?.status).toBe("failed")
        expect(state?.summary).toBe("First result")
      },
    })
  })

  test("rejects when the parent session is missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const child = await Session.create({ parentID: Identifier.ascending("session"), agentID: "orchestrator" })
        const impl = await HandoffToPMTool.init()

        await expect(impl.execute({ status: "failed", summary: "No parent" }, ctx(child.id))).rejects.toThrow(
          "Parent PM session not found",
        )
      },
    })
  })

  test("rejects non-Orchestrator child sessions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "PM" })
        const child = await Session.create({ parentID: parent.id, agentID: "investigator" })
        const impl = await HandoffToPMTool.init()

        await expect(impl.execute({ status: "completed", summary: "Not allowed" }, ctx(child.id))).rejects.toThrow(
          "handoff_to_pm can only be called from an orchestrator session",
        )
      },
    })
  })

  test("works for a resumed Orchestrator without a live parent task wait", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, child } = await createOrchestratorPair()
        const impl = await HandoffToPMTool.init()

        await impl.execute({ status: "cancelled", summary: "User cancelled after resume" }, ctx(child.id))

        expect(await parentHandoffMessages(parent.id)).toHaveLength(1)
        expect(await OrchestratorCompletion.listByParent(parent.id)).toHaveLength(1)
      },
    })
  })
})
