# Spec: finish_task Robustness (OCO 1.0.35)

## Problem

The PM–Orchestrator handoff via `finish_task` breaks whenever the OCO server restarts between the
time the PM starts waiting and the time the Orchestrator finishes. The failure is deterministic:

1. PM calls `task` tool → child (Orchestrator) session created in SQLite, survives restart.
2. PM's `task.ts` registers an **in-memory** `Promise` (`finishTaskPromise`) and an **in-memory**
   Bus subscription to wait for the child's `finish_task` completion.
3. Server shuts down → promise + Bus subscription evaporate (zero persistence).
4. Orchestrator eventually calls `finish_task` → child's `part` row in SQLite is written with the
   completed state + metadata. Bus event fires into the void (no listener).
5. PM's `task` tool part is **permanently stuck in pending/running state**.
6. When the user resumes PM, history reconstruction (`toModelMessages`) returns the `task` tool
   call with no result → LLM context is malformed, PM cannot continue.

The data needed to complete the parent part already exists in SQLite (child's `finish_task` part);
only the live handoff step is missing.

### Two distinct failure scenarios

| Scenario | State on restart | Fix needed |
|---|---|---|
| A — Orchestrator **called** `finish_task` before/during restart | Child part `completed` in SQLite; parent task part `pending` | Auto-complete parent part from child's stored data |
| B — Orchestrator was **still running** when restart happened | Child part absent or `pending`; Orchestrator loop dead | Out of scope for this spec (user manually resumes Orchestrator) |

This spec addresses **Scenario A** — the case where `finish_task` has been called but the result
was not delivered to the PM.

---

## Root Cause (Precise)

`packages/opencode/src/tool/task.ts` (persistent orchestrator path, line ~281):
- Sets up a Bus subscription keyed to `MessageV2.Event.PartUpdated` for the child session.
- Waits on `finishTaskPromise` for the child's `finish_task` part to become `completed`.
- Only after resolution does it call `Session.updatePart()` to mark the *parent* task part done.

This means the parent task part's completion **requires the live handoff** — it is never written
to SQLite independently of the in-memory promise chain.

`packages/opencode/src/session/processor.ts` (line ~182):
- Processes tool results and writes the child's `finish_task` part to SQLite.
- Emits `MessageV2.Event.PartUpdated` (Bus event).
- Does **not** touch the parent session.

---

## Fix: Write-Through + Startup Recovery

### Change 1 — Write-Through in `finish-task.ts` (or `processor.ts`)

When `finish_task` is executed in the child session, **also update the parent session's `task` tool
part in the same DB write window**.

Concretely, after the child's part is written to SQLite:

1. Load the child session to get `parentID`.
2. If `parentID` exists, iterate the parent session's message parts to find the `task` tool part
   whose `state.metadata.sessionId === childSessionID` (this linkage is already stored by
   `task.ts:174` when the child session is created).
3. Construct the same completed-state shape that `task.ts:349–360` currently writes:
   ```
   state.status = "completed"
   state.title   = <title from finish_task result>
   state.output  = <output from finish_task result>
   state.metadata = <metadata from finish_task result>
   ```
4. Call `Session.updatePart()` on the **parent** session with this state.

The happy-path (no restart) still works: the Bus event fires, the in-memory listener resolves the
promise, and `task.ts` tries to write the same completed state again — that is an idempotent upsert
and does no harm.

The write-through should be placed where the child's tool result is already available. The natural
location is either:
- Inside `finish-task.ts` `execute()` — before returning the result — or
- In `processor.ts` immediately after it writes the child's `finish_task` part.

The Orchestrator decides which is cleaner given the session/db layer access patterns available at
each location.

### Change 2 — Startup Recovery Scan

On project load (or at a suitable initialization point), run a one-shot recovery pass:

For each session row where `parent_id IS NOT NULL`:
1. Check whether the child session has a `part` row with `tool = 'finish_task'` and
   `state.status = 'completed'`.
2. If yes, check whether the parent session has a `task` tool part whose `metadata.sessionId`
   matches this child session and whose `state.status` is **not** `completed`.
3. If yes, write the completed state to the parent part (same shape as Change 1 step 3, sourcing
   data from the child's `finish_task` part).

This catches any cases that slipped through before Change 1 was deployed, and handles the narrow
timing window where the server crashes after the child write but before the parent write.

The scan must be efficient and non-blocking: run it in the background, and exit early per session
once the condition is confirmed satisfied.

---

## Scope

- `packages/opencode/src/tool/finish-task.ts`
- `packages/opencode/src/session/processor.ts` (possibly, depending on implementation choice)
- `packages/opencode/src/tool/task.ts` (no changes to happy-path logic; may add helper)
- `packages/opencode/src/session/index.ts` (startup scan entry point, or new utility)
- No UI changes required.

---

## Acceptance Criteria

1. **Write-through**: After `finish_task` is called in the child session, the parent session's
   `task` tool part is `completed` in SQLite **before** the function returns (or before any Bus
   event propagation is relied upon).
2. **Idempotent**: Calling `finish_task` when the parent part is already completed (e.g., happy
   path where Bus listener already fired) does not corrupt state.
3. **Startup recovery**: On server start, any parent session with a pending `task` part whose
   child has a completed `finish_task` part is repaired automatically. PM sessions with previously
   stuck `task` tool parts become resumable without user intervention.
4. **No regression**: The happy-path (no restart) continues to work. Typecheck passes.

## Verification

- Simulate the failure: start a task, kill the server while Orchestrator is mid-run, restart, have
  Orchestrator call `finish_task`, check that PM's session history shows the completed task result.
- Check that `bun run typecheck` passes in `packages/opencode`.
