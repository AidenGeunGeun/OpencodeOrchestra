import { Tool } from "./tool"
import { Bus } from "../bus"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { SessionStatus } from "../session/status"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { AsyncResult } from "../session/async-result"
import { TaskToolParameters, type TaskToolParams, prepareTaskSession, renderTaskDescription } from "./task"

const log = Log.create({ service: "async-task" })

const DESCRIPTION = `Launch a new agent in the background to handle complex, multistep tasks asynchronously.

Available agent types and the tools they have access to:
{agents}

Use this when you want the same subagents as task, but do not need to block waiting for the result. The tool returns immediately with a task_id, and the final result arrives later as an <async-result> message.

When to use async_task:
- When the next step does not depend on the subagent's result — spawn and continue
- When running multiple parallel investigators or researchers at once
- When background work can complete while you handle other things

When NOT to use async_task:
- If your next step requires the result — use task instead (it blocks until done)
- If you want to read a specific file, use the Read or Glob tool directly
- If searching code in 2-3 files, use Read directly — a subagent adds unnecessary overhead
- NEVER use async_task with the orchestrator subagent_type — orchestrators run for minutes to hours and if the app closes the result is silently lost; always use task for orchestrators

Receiving results:
When the subagent finishes, a synthetic user message is injected into the conversation:

  <async-result task_id="..." agent="..." status="completed|failed|cancelled">
  <summary>
  ...summary text...
  </summary>
  <learnings>           (optional — key facts worth preserving)
  - item
  </learnings>
  </async-result>

Match the task_id attribute to the value returned when you spawned the task. Read the status before acting — if "failed", handle it gracefully. Tasks time out after 10 minutes if the subagent does not complete; a failed async-result is injected automatically.

Usage notes:
1. Spawn multiple async tasks in a single turn to run work in parallel — this is the primary advantage over task.
2. The immediate tool output confirms spawning only. The actual result arrives later as an <async-result> message.
3. Your prompt should be fully self-contained with exactly what information to return, since the agent cannot ask follow-up questions.
4. Clearly tell the agent whether you expect it to write code or just do research.
5. Prefer investigator, web-search, auditor, or docs for background work. Never use orchestrator with async_task.`

type AsyncTaskStatus = "completed" | "failed"

const ASYNC_TASK_TIMEOUT_MS = 10 * 60 * 1000

function getSessionErrorMessage(error: MessageV2.Assistant["error"] | undefined) {
  if (!error) return "Async task failed"
  if ("message" in error && typeof error.message === "string") return error.message
  return JSON.stringify(error)
}

async function readChildIdleOutcome(input: {
  sessionID: string
  singleShot: boolean
}): Promise<
  | {
      status: AsyncTaskStatus
      summary: string
      learnings?: string[]
    }
  | {
      error: string
    }
> {
  const messages = await Session.messages({ sessionID: input.sessionID })
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "tool") continue
      if (part.tool !== "finish_task") continue
      if (part.state.status !== "completed") continue
      return readFinishTaskResult(part)
    }
  }

  const assistantMessage = messages.findLast(
    (message): message is MessageV2.WithParts & { info: MessageV2.Assistant } => message.info.role === "assistant",
  )
  if (!assistantMessage) {
    return {
      error: "agent produced no response.",
    }
  }

  if (assistantMessage.info.error) {
    return {
      error: getSessionErrorMessage(assistantMessage.info.error),
    }
  }

  if (!assistantMessage.info.time.completed) {
    return {
      error: "agent produced no response.",
    }
  }

  const summary = assistantMessage.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()

  if (!summary) {
    return {
      error: input.singleShot ? "agent produced no response." : "agent did not report completion before going idle.",
    }
  }

  return {
    status: "completed",
    summary,
  }
}

function readFinishTaskResult(part: MessageV2.ToolPart): {
  status: AsyncTaskStatus
  summary: string
  learnings?: string[]
} {
  const metadata = part.state.status === "completed" ? part.state.metadata : undefined
  const status = metadata?.status
  const learnings = Array.isArray(metadata?.learnings)
    ? metadata.learnings.filter((item: unknown): item is string => typeof item === "string")
    : undefined

  return {
    status: status === "completed" ? "completed" : "failed",
    summary: typeof metadata?.summary === "string" ? metadata.summary : "Task completed",
    learnings,
  }
}

function watchAsyncTaskCompletion(input: {
  parentSessionID: string
  childSessionID: string
  agent: string
  singleShot: boolean
  onSettle?: () => void
}) {
  let settled = false
  const unsubscribers: Array<() => void> = []
  const timeout = setTimeout(() => {
    settle(async () => {
      SessionPrompt.cancel(input.childSessionID)
      await AsyncResult.injectError(
        input.parentSessionID,
        input.childSessionID,
        input.agent,
        "Async task timed out after 10 minutes.",
      )
    })
  }, ASYNC_TASK_TIMEOUT_MS)

  const cleanup = () => {
    clearTimeout(timeout)
    while (unsubscribers.length) {
      const unsubscribe = unsubscribers.pop()
      unsubscribe?.()
    }
  }

  const settle = (deliver: () => Promise<void>) => {
    if (settled) return
    settled = true
    cleanup()
    input.onSettle?.()
    void deliver().catch((error) => {
      log.error("failed to inject async result", {
        error: String(error),
        sessionID: input.childSessionID,
      })
    })
  }

  if (!input.singleShot) {
    unsubscribers.push(
      Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== input.childSessionID) return
        if (evt.properties.part.type !== "tool") return
        if (evt.properties.part.tool !== "finish_task") return
        if (evt.properties.part.state.status !== "completed") return

        const result = readFinishTaskResult(evt.properties.part)
        settle(async () => {
          await AsyncResult.inject(input.parentSessionID, {
            taskID: input.childSessionID,
            agent: input.agent,
            status: result.status,
            summary: result.summary,
            learnings: result.learnings,
          })
        })
      }),
    )
  }

  unsubscribers.push(
    Bus.subscribe(SessionStatus.Event.Status, async (evt) => {
      if (evt.properties.sessionID !== input.childSessionID) return
      if (evt.properties.status.type !== "idle") return
      const outcome = await readChildIdleOutcome({
        sessionID: input.childSessionID,
        singleShot: input.singleShot,
      })

      if ("error" in outcome) {
        settle(async () => {
          await AsyncResult.injectError(input.parentSessionID, input.childSessionID, input.agent, outcome.error)
        })
        return
      }

      settle(async () => {
        await AsyncResult.inject(input.parentSessionID, {
          taskID: input.childSessionID,
          agent: input.agent,
          status: outcome.status,
          summary: outcome.summary,
          learnings: outcome.learnings,
        })
      })
    }),
  )

  unsubscribers.push(
    Bus.subscribe(Session.Event.Error, async (evt) => {
      if (evt.properties.sessionID !== input.childSessionID) return

      settle(async () => {
        await AsyncResult.injectError(
          input.parentSessionID,
          input.childSessionID,
          input.agent,
          getSessionErrorMessage(evt.properties.error),
        )
      })
    }),
  )

  return {
    fail(error: string) {
      settle(async () => {
        await AsyncResult.injectError(input.parentSessionID, input.childSessionID, input.agent, error)
      })
    },
  }
}

export const AsyncTaskTool = Tool.define("async_task", async (ctx) => {
  const description = await renderTaskDescription(DESCRIPTION, ctx?.agent)

  return {
    description,
    parameters: TaskToolParameters,
    async execute(params: TaskToolParams, ctx) {
      const prepared = await prepareTaskSession(params, ctx, { async: true })
      const { session, agent, promptParts, toolsOverlay, model, singleShot } = prepared

      const watcher = watchAsyncTaskCompletion({
        parentSessionID: ctx.sessionID,
        childSessionID: session.id,
        agent: agent.name,
        singleShot,
        onSettle: prepared.cleanup,
      })

      if (ctx.abort.aborted) {
        SessionPrompt.cancel(session.id)
      } else {
        try {
          SessionPrompt.prompt({
            messageID: Identifier.ascending("message"),
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: toolsOverlay,
            parts: promptParts,
          }).catch((error) => {
            log.error("async subagent prompt failed", {
              error: String(error),
              sessionID: session.id,
            })
            watcher.fail(error instanceof Error ? error.message : String(error))
          })
        } catch (error) {
          log.error("async subagent prompt threw before starting", {
            error: String(error),
            sessionID: session.id,
          })
          watcher.fail(error instanceof Error ? error.message : String(error))
        }
      }

      return {
        title: `${params.description} (@${agent.name} async subagent)`,
        metadata: {
          sessionId: session.id,
          model,
          async: true,
        },
        output: `task_id: ${session.id}\n\n<task_spawned>${params.description} (@${agent.name} subagent) spawned asynchronously. Results will arrive as an <async-result> message when the task completes.</task_spawned>`,
      }
    },
  }
})
