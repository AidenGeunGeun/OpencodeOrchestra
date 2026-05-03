import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  }, 15000)

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  }, 15000)
})

describe("session.part updates", () => {
  test("publishes cloned payloads for delta-based part updates", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)

        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "hello",
        }

        let received: MessageV2.Part | undefined
        let receivedDelta: string | undefined
        const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          received = event.properties.part
          receivedDelta = (event.properties as { delta?: string }).delta
        })

        await Session.updatePart({ part, delta: " world" })
        part.text = "mutated after publish"

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(received).toBeDefined()
        expect(received).not.toBe(part)
        expect(receivedDelta).toBe(" world")
        expect((received as MessageV2.TextPart).text).toBe("hello")

        unsub()
        await Session.remove(session.id)
      },
    })
  })
})

const tokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

function createUserMessage(sessionID: string, created: number): MessageV2.User {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
  }
}

function createAssistantMessage(sessionID: string, parentID: string, created: number): MessageV2.Assistant {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    parentID,
    time: { created, completed: created + 1 },
    modelID: "test",
    providerID: "test",
    mode: "build",
    agent: "build",
    path: { cwd: projectRoot, root: projectRoot },
    cost: 0,
    tokens,
    finish: "tool-calls",
  }
}

function createTaskPart(sessionID: string, messageID: string, childSessionID: string, callID: string): MessageV2.ToolPart {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "tool",
    tool: "task",
    callID,
    state: {
      status: "completed",
      input: { description: "task" },
      output: `task_id: ${childSessionID}`,
      title: "task completed",
      metadata: { sessionId: childSessionID },
      time: { start: Date.now(), end: Date.now() + 1 },
    },
  }
}

function createRunningTaskPart(
  sessionID: string,
  messageID: string,
  childSessionID: string,
  callID: string,
): MessageV2.ToolPart {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "tool",
    tool: "task",
    callID,
    state: {
      status: "running",
      input: { description: "task" },
      title: "task running",
      metadata: { sessionId: childSessionID },
      time: { start: Date.now() },
    },
  }
}

function createFinishTaskPart(sessionID: string, messageID: string): MessageV2.ToolPart {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    type: "tool",
    tool: "finish_task",
    callID: "call-finish-task",
    state: {
      status: "completed",
      input: { summary: "done", status: "completed", learnings: [] },
      output: "Task completed. Control returned to parent agent.",
      title: "Task completed: done",
      metadata: { status: "completed", summary: "done", learnings: [] },
      time: { start: Date.now(), end: Date.now() + 1 },
    },
  }
}

async function addTextMessage(sessionID: string, text: string, created: number) {
  const message = createUserMessage(sessionID, created)
  await Session.updateMessage(message)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: message.id,
    type: "text",
    text,
  })
  return message
}

async function addTaskTurn(input: {
  sessionID: string
  childSessionID: string
  callID: string
  created: number
}) {
  const user = await addTextMessage(input.sessionID, `run ${input.callID}`, input.created)
  const assistant = createAssistantMessage(input.sessionID, user.id, input.created + 1)
  await Session.updateMessage(assistant)
  await Session.updatePart(createTaskPart(input.sessionID, assistant.id, input.childSessionID, input.callID))
  return { user, assistant }
}

describe("session messages", () => {
  test("does not repair running task parts while reading messages", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id, agentID: "orchestrator", title: "Child task" })
        const baseTime = Date.now()

        const childUser = await addTextMessage(child.id, "finish", baseTime)
        const childAssistant = createAssistantMessage(child.id, childUser.id, baseTime + 1)
        await Session.updateMessage(childAssistant)
        await Session.updatePart(createFinishTaskPart(child.id, childAssistant.id))

        const parentUser = await addTextMessage(parent.id, "run task", baseTime + 2)
        const parentAssistant = createAssistantMessage(parent.id, parentUser.id, baseTime + 3)
        await Session.updateMessage(parentAssistant)
        const runningTask = createRunningTaskPart(parent.id, parentAssistant.id, child.id, "call-task-running")
        await Session.updatePart(runningTask)

        let repaired = false
        const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          if (event.properties.part.id === runningTask.id) repaired = true
        })

        const messages = await Session.messages({ sessionID: parent.id })
        const taskPart = messages.flatMap((message) => message.parts).find((part) => part.id === runningTask.id)

        unsub()

        expect(taskPart?.type).toBe("tool")
        if (taskPart?.type !== "tool") throw new Error("missing task part")
        expect(taskPart.state.status).toBe("running")
        expect(repaired).toBe(false)

        await Session.remove(parent.id)
        await Session.remove(child.id)
      },
    })
  }, 15000)
})

describe("session fork", () => {
  test("copies child sessions and remaps task metadata without mutating the source", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const source = await Session.create({})
        const child = await Session.create({
          parentID: source.id,
          agentID: "investigator",
          async: true,
          title: "Investigate fork state",
        })
        await addTextMessage(child.id, "child work", Date.now())
        await addTaskTurn({ sessionID: source.id, childSessionID: child.id, callID: "call-task-1", created: Date.now() })

        const fork = await Session.fork({ sessionID: source.id })
        const sourceChildren = await Session.children(source.id)
        const forkChildren = await Session.children(fork.id)

        expect(sourceChildren.map((item) => item.id)).toEqual([child.id])
        expect(forkChildren).toHaveLength(1)
        expect(forkChildren[0].id).not.toBe(child.id)
        expect(forkChildren[0].parentID).toBe(fork.id)
        expect(forkChildren[0].agentID).toBe("investigator")
        expect(forkChildren[0].async).toBe(true)

        const forkMessages = await Session.messages({ sessionID: fork.id })
        const forkTaskPart = forkMessages.flatMap((message) => message.parts).find((part) => part.type === "tool")
        expect(forkTaskPart?.type).toBe("tool")
        if (forkTaskPart?.type !== "tool") throw new Error("missing fork task part")
        expect(forkTaskPart.state.status).toBe("completed")
        if (forkTaskPart.state.status !== "completed") throw new Error("unexpected task state")
        expect(forkTaskPart.state.metadata.sessionId).toBe(forkChildren[0].id)
        expect(forkTaskPart.state.output).toContain(forkChildren[0].id)
        expect(forkTaskPart.state.output).not.toContain(child.id)

        const forkChildMessages = await Session.messages({ sessionID: forkChildren[0].id })
        expect(forkChildMessages).toHaveLength(1)
        expect(forkChildMessages[0].info.sessionID).toBe(forkChildren[0].id)
        expect(forkChildMessages[0].info.id).not.toBe((await Session.messages({ sessionID: child.id }))[0].info.id)

        await Session.create({ parentID: fork.id, title: "Fork-only child" })
        expect(await Session.children(source.id)).toHaveLength(1)
        expect(await Session.children(fork.id)).toHaveLength(2)

        await Session.remove(source.id)
        await Session.remove(fork.id)
      },
    })
  }, 15000)

  test("excludes future-only child sessions when forking at a cutoff message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const source = await Session.create({})
        const childBefore = await Session.create({ parentID: source.id, title: "Before cutoff" })
        const childAfter = await Session.create({ parentID: source.id, title: "After cutoff" })
        const baseTime = Date.now()

        await addTextMessage(childBefore.id, "child before cutoff", baseTime + 1)
        await addTaskTurn({ sessionID: source.id, childSessionID: childBefore.id, callID: "call-before", created: baseTime + 2 })
        const cutoff = createUserMessage(source.id, baseTime + 10)
        await Session.updateMessage(cutoff)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: source.id,
          messageID: cutoff.id,
          type: "text",
          text: "cutoff",
        })
        await addTextMessage(childBefore.id, "child after cutoff", baseTime + 20)
        const afterAssistant = createAssistantMessage(source.id, cutoff.id, baseTime + 21)
        await Session.updateMessage(afterAssistant)
        await Session.updatePart(createTaskPart(source.id, afterAssistant.id, childAfter.id, "call-after"))

        const fork = await Session.fork({ sessionID: source.id, messageID: cutoff.id })
        const forkChildren = await Session.children(fork.id)
        const forkMessages = await Session.messages({ sessionID: fork.id })

        expect(await Session.children(source.id)).toHaveLength(2)
        expect(forkChildren).toHaveLength(1)
        expect(forkChildren[0].title).toBe("Before cutoff")
        expect(forkMessages.map((message) => message.info.id)).not.toContain(cutoff.id)
        expect(forkMessages).toHaveLength(2)
        const forkChildMessages = await Session.messages({ sessionID: forkChildren[0].id })
        expect(forkChildMessages).toHaveLength(1)
        expect(forkChildMessages[0].parts.find((part) => part.type === "text" && part.text === "child before cutoff")).toBeDefined()

        await Session.remove(source.id)
        await Session.remove(fork.id)
      },
    })
  }, 15000)
})
