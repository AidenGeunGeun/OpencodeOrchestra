# UPSTREAM-DIFF.md — OpenCodeOrchestra vs opencode 1.2.5

Exhaustive file-by-file documentation of all divergences from upstream opencode 1.2.5.

**Stats (as of 2026-02-18):** 352 shared src files — 118 modified, 34 added, 0 removed.
Tests: 4 new files, 35 modified files. 884 pass / 29 skip / 0 fail.

**v1.0.31 additions:** `session/prompt.ts` (pending clickability + agent null-checks), `tool/task.ts`
(conditional todo deny), `session/llm.ts` (agent name in hooks), `plugin/index.ts` (config hook
robustness), `packages/ui/src/context/marked.tsx` (table rendering fix).

**v1.0.32 additions:** `agent/agent.ts` (`effort` → `variant` alias), `packages/app/src/context/local.tsx`
(derived model resolution), `packages/app/src/pages/session.tsx` (removed sync effects),
`packages/app/src/pages/session/session-model-helpers.ts` (NEW — pure model helper),
`packages/app/src/components/session-context-usage.tsx` (cached token display).

> **Sync rule:** Orchestra-Only files (Category 1) must NEVER be overwritten.
> All other categories must be re-applied as patches after upstream merges.

---

## Category 1: Orchestra-Only Files (DO NOT TOUCH on sync)

These files contain the multi-agent hierarchy unique to OCO and have no upstream equivalent.
They implement the PM → Orchestrator → Subagent depth model.

### `agent/agent.ts` — Agent definitions

**Added to `Agent.Info` schema (line 56):**
```ts
singleShot: z.boolean().default(true),
```
Controls whether an agent auto-returns its first response to the parent (`true`, default for subagents)
or waits for an explicit `finish_task` call (`false`, for orchestrators).

**5 new agent definitions** added to the state initializer:
`orchestrator`, `investigator`, `auditor`, `web-search`, `docs`

Each agent has `mode: "subagent"`, a description, `singleShot` value, and a custom prompt.

**v1.0.32 addition (line 357):** `effort` accepted as an alias for `variant` when merging agent
config overrides from `oco.jsonc`:
```ts
item.variant = value.variant ?? value.effort ?? item.variant
```
Allows `effort: "high"` in existing configs to continue working without renaming the key.

---

### `agent/prompt/orchestrator.txt` — NEW FILE
### `agent/prompt/investigator.txt` — NEW FILE
### `agent/prompt/auditor.txt` — NEW FILE
### `agent/prompt/web-search.txt` — NEW FILE
### `agent/prompt/docs.txt` — NEW FILE

Custom system prompts for each OCO agent. Not present in upstream.

Also added: `agent/prompt/pm.txt`, `agent/prompt/pm-plan.txt` — PM-specific system prompts.

---

### `session/depth.ts` — NEW FILE

Exports three functions for depth-based session hierarchy management:

```ts
export async function calculateDepth(sessionID: string): Promise<number>
export function shouldApplyPruning(depth: number): boolean          // true if depth <= 1
export async function shouldApplyPruningForSession(sessionID: string): Promise<boolean>
```

Depth model:
- `0` = PM (root, no parent)
- `1` = Orchestrator (PM's child)
- `2+` = Subagent (Orchestrator's children and beyond)

`calculateDepth` traverses the `parentID` chain with cycle detection (max depth: 100).

Used by `plugin/client-wrapper.ts` and `tool/task.ts`.

---

### `tool/finish-task.ts` — NEW FILE

Defines `FinishTaskTool` — a tool for orchestrators to signal task completion.

Parameters: `summary: string`, `status: "completed" | "failed" | "cancelled"`, `learnings?: string[]`

Returns a metadata payload containing `parentSessionID`, `childSessionID`, `status`, `summary`,
`learnings`. Requires the current session to have a `parentID` (enforced at runtime, line 39–42).

Only available to orchestrators (depth 1). The tool result is received by the Bus event listener
registered in `tool/task.ts`.

---

### `tool/task.ts` — Modified (OCO additions)

Major additions on top of upstream `task` tool:

**Depth computation (lines 72–83):** local `calculateDepth()` traverses `parentID` chain to determine
caller depth (`currentDepth`).

**Child depth assignment (lines 90–98):**
- PM (depth 0) + `orchestrator` → child depth 1
- PM (depth 0) + other agent → child depth 2 (skips depth 1)
- Orchestrator (depth 1) + any → child depth `currentDepth + 1`

**singleShot enforcement (line 104):** depth 2+ is ALWAYS `singleShot = true` regardless of agent config.

**Session creation (lines 120–150):** passes `agentID: agent.name` to `Session.create()`.

**Bus event listener (lines 171–192):** subscribes to `MessageV2.Event.PartUpdated` to aggregate
subagent tool parts for metadata display.

**Single-shot path (lines 202–254):** awaits `SessionPrompt.prompt()`, returns result with `task_id`.

**Persistent orchestrator path (lines 256–355):**
- Registers a `finishTaskPromise` (line 267) that listens for `finish_task` tool completion via Bus.
- Fires `SessionPrompt.prompt()` without awaiting (line 297) — orchestrator runs independently.
- Awaits `finishTaskPromise` (line 319) — blocks until orchestrator calls `finish_task`.
- `finish_task: true` injected into tools for the orchestrator prompt (line 308).
- DCP primary tools intentionally NOT denied for depth-1 orchestrators (line 310 comment).

**v1.0.31 addition (lines 69–74):** `hasTodoWritePermission` and `hasTodoReadPermission` checks
added alongside the existing `hasTaskPermission` pattern. Previously `todowrite` and `todoread`
were unconditionally denied for all spawned child sessions. Now the deny rule is omitted when
the agent config explicitly grants that permission:
```ts
const hasTodoWritePermission = agent.permission.some(
  (rule) => rule.permission === "todowrite" && rule.action === "allow",
)
const hasTodoReadPermission = agent.permission.some(
  (rule) => rule.permission === "todoread" && rule.action === "allow",
)
```
Applied at lines 130–148 when building the child session permission array, matching the
pre-existing `hasTaskPermission` conditional-deny pattern.

---

### `tool/registry.ts` — Modified

```ts
import { FinishTaskTool } from "./finish-task"
// ...
FinishTaskTool,   // line 110 — registered in tool list
```

Also registers `TodoReadTool` (imported as `todoread` tool for session-level todo access).

---

### `plugin/client-wrapper.ts` — NEW FILE

Exports `wrapClientForDepthAwareness(client: OpencodeClient): OpencodeClient`.

Wraps `client.session.get()` using a Proxy. On each call:
1. Gets the real session via the original `session.get()`.
2. Calls `calculateDepth(sessionID)`.
3. If `shouldApplyPruning(depth)` (depth ≤ 1): strips `parentID` from the response so DCP applies pruning.
4. If depth ≥ 2: returns original response (DCP skips pruning for subagents).

Fail-safe: on any error, returns the original unmodified response (line 92–99).

---

### `plugin/index.ts` — Modified

```ts
import { wrapClientForDepthAwareness } from "./client-wrapper"
// ...
const client = wrapClientForDepthAwareness(rawClient)  // line 33
```

Wraps the raw SDK client before passing it to plugins, enabling depth-aware DCP behavior.

**v1.0.31 addition:** `init()` now wraps each `hook.config?.(config)` call in a try/catch so that
a single broken plugin cannot abort initialization for all remaining plugins. See Category 3 for
the full bug-fix entry.

---

### `session/index.ts` — Modified (agentID sidecar + Session.update)

**`agentID` sidecar storage (lines 46–60):**
- `sessionAgentKey(sessionID)` — storage key `["session_agent", projectID, sessionID]`
- `getAgentID(sessionID)` — reads from JSON sidecar storage
- `setAgentID(sessionID, agentID)` — writes/removes sidecar file

**`Session.Info` (line 127):** `agentID?: string` field added.

**`Session.create()` (line 213):** accepts `agentID?: string`, stores to sidecar after creation.

**`Session.get()` (line 328):** populates `info.agentID` from sidecar on every read.

**`Session.update()` (line 370):** new generic draft-editor function. Accepts `(id, editor, options?)`.
Reads existing `agentID` sidecar, applies editor to draft, persists both row and sidecar.
Replaces most direct uses of `setTitle()` and `setPermission()` in callers.

**`Session.getShare()` (line 332):** simplified to `Storage.read<ShareInfo>(["share", id])`.
`share()` and `unshare()` (lines 336–368): populate `info.agentID` from sidecar in Bus events.

**`Session.updatePart()` (line 659):** union type input — accepts bare `MessageV2.Part` or
`{ part: MessageV2.Part; delta: string }`. Includes `delta` in the Bus event payload.
Upstream had a separate `updatePartDelta()` function; this consolidates both.

---

### `session/processor.ts` — Modified (updatePart pattern)

Uses `Session.updatePart({ part, delta: value.text })` instead of `Session.updatePartDelta(...)`.
Local `normalizeFinishReason()` function (line 23) wraps AI SDK 6.x finish reason objects (see Category 2).
Also: removed `if (MessageV2.ContextOverflowError.isInstance(error)) { /* TODO */ }` block.
Text part start time preserved: `start: currentText.time?.start ?? Date.now()` (line 330).

---

### `config/config.ts` — Modified

Line 634: `single_shot: z.boolean().optional()` added to agent schema.
Line 658: `"single_shot"` added to `knownKeys` set (prevents it being absorbed into `options`).

---

### `cli/cmd/tui/app.tsx` — Modified (agent cycle lock)

Lines 477–484 and 508–515: agent cycle keybinds (`agent_cycle`, `agent_cycle_reverse`) check
`session.agentID` — if set, display a toast warning instead of cycling. Locks subagent sessions
to their assigned agent.

---

### `cli/cmd/tui/routes/session/index.tsx` — Modified (model reset, sibling nav)

Lines 181–183: on session load, if `session.agentID` is set, looks up the agent config to apply
agent-specific model defaults.

Lines 314–330: sibling navigation (`navigateSibling(direction)`). Groups sessions by `agentID`:
- PM sessions (no `agentID`) navigate among PM sessions.
- Subagent sessions navigate among siblings with the same `agentID`.

Lines 889, 900: "Next sibling session" and "Previous sibling session" keybind entries.

Also: `oco -s` shortcut support and model reset on new session.

---

### `cli/cmd/tui/routes/session/sidebar.tsx` — Modified (branding)

Line 309: displays `<b>Orchestra</b>` in the sidebar to brand the fork.

---

### `cli/cmd/tui/component/prompt/index.tsx` — Modified (effectiveAgent)

Lines 121–124:
```ts
const effectiveAgent = createMemo(() => {
  // ...
  return session?.agentID ?? local.agent.current().name
})
```
Uses the session's locked `agentID` (for subagent sessions) instead of the locally selected agent.
`effectiveAgent()` used in all `SessionPrompt.prompt()` calls within the component.

---

### `cli/cmd/tui/context/local.tsx` — Modified (model.clear)

Line 305: `clear(agentName?: string)` method added to the model context. Resets model selection,
optionally switching to a specific agent's default model.

---

### `storage/json-migration.ts` — Modified (agentID sidecar backfill)

Lines 236–258: migration step backfills `agentID` sidecar files for legacy sessions that stored
`agentID` inline in session JSON. Reads each session's JSON, extracts `agentID`, writes sidecar.

---

### `session/prompt.ts` — Modified (OCO additions)

**v1.0.31 — Subagent pending clickability (line 783):** The `metadata` callback guard inside
`resolveTools()` was extended to accept `"pending"` in addition to `"running"`:
```ts
if (match && ["running", "pending"].includes(match.state.status)) {
```
The old check only matched `"running"`, which meant pending subtask tool parts never received
metadata updates and were not interactive in the UI. The expanded check lets the UI render
pending subtasks as clickable before the subagent session fully starts.

**v1.0.31 — Agent null-checks (multiple locations):** Explicit null-checks added after every
`Agent.get()` call. When the agent is not found, a `Bus.publish(Session.Event.Error, ...)` event
is fired with a message listing available agents, then an error is thrown. Affected call sites:
- Line 431: `taskAgent` null-check in the pending-subtask handling path
- Lines 583–592: `agent` null-check in the normal processing loop
- Lines 989–998: `agent` null-check in `createUserMessage()`

All three follow the same pattern:
```ts
const available = await Agent.list()
  .then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
const error = new NamedError.Unknown({ message: `Agent not found: "${name}".${hint}` })
Bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
throw error
```

---

### `session/llm.ts` — Modified (plugin hook agent name)

**v1.0.31 (lines 122 and 140):** Both `Plugin.trigger()` calls in `stream()` were updated to
pass `input.agent.name` (a string) instead of `input.agent` (the full `Agent.Info` object):

```ts
// chat.params hook (line 122):
agent: input.agent.name,

// chat.headers hook (line 140):
agent: input.agent.name,
```

Plugin hooks declare `agent` as `string` in the `@opencode-ai/plugin` SDK type, so passing the
full object caused a type mismatch and could confuse plugins that stringify the value.

---

## Category 2: AI SDK 6.x Migration

Upgrade from `ai` 5.0.124 to 6.0.90. Also upgrades all `@ai-sdk/*` provider packages
(major version bump for each). See AGENTS.md "AI SDK 6.x — Package Versions" table.

### `packages/opencode/package.json`

All `@ai-sdk/*` packages bumped one major version. Added `provider/sdk/openai-compatible/src/`
as a new bundled OpenAI-compatible provider SDK.

### `session/index.ts` — `getUsage()` rewrite

**Removed:** `excludesCachedTokens` provider-conditional flag (AI SDK 5.x pattern).

**Added:** `normalizeTokenCount(val: unknown): number` (line 692) — handles AI SDK 6.x
`{ total: number }` usage objects in addition to plain numbers.

**Token calculation (lines 701–713):**
```ts
const cacheReadInputTokens = normalizeTokenCount(input.usage.cachedInputTokens)
const cacheWriteInputTokens = normalizeTokenCount(
  input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
  input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
  input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
  0,
)
const adjustedInputTokens =
  normalizeTokenCount(input.usage.inputTokens) - cacheReadInputTokens - cacheWriteInputTokens
```

Also added `reasoning` field to token result: `reasoning: safe(normalizeTokenCount(input.usage.reasoningTokens))`.

**Upstream 1.2.5 diff:**
- Used `input.usage.cachedInputTokens ?? 0` directly (no `normalizeTokenCount`).
- Had `excludesCachedTokens` flag → only subtracted cache for Anthropic/Bedrock.
- No `reasoning` field in token result.

### `session/processor.ts` — finish reason normalization + updatePart

**Added (line 23):**
```ts
function normalizeFinishReason(fr: unknown): string {
  if (typeof fr === "string") return fr
  if (fr && typeof fr === "object" && "unified" in fr) {
    return (fr as { unified?: unknown }).unified?.toString() ?? "unknown"
  }
  return "unknown"
}
```

Applied at lines 252 and 257 where `value.finishReason` is consumed.

**updatePart pattern:** `Session.updatePartDelta({ sessionID, messageID, partID, field, delta })` calls
replaced with `Session.updatePart({ part, delta: value.text })` (lines 94, 309). Text guard added:
`if (part.text) await Session.updatePart(...)` to skip empty delta writes.

### `session/prompt.ts` — finish reason + LoopInput

**Added (line 63):** same `normalizeFinishReason()` as in `processor.ts`.

Applied at line 332:
```ts
!["tool-calls", "unknown"].includes(normalizeFinishReason(lastAssistant.finish))
```
Upstream compared `lastAssistant.finish` directly as a string.

**`LoopInput` (lines 281–289):** changed from plain object to union:
```ts
export const LoopInput = z.union([
  Identifier.schema("session"),
  z.object({ sessionID: Identifier.schema("session"), resume_existing: z.boolean().optional() }),
])
```

**`Session.setPermission` → `Session.update` (line 177):**
```ts
await Session.update(session.id, (draft) => { draft.permission = permissions })
```

**`resume_existing` fix (line 277):**
```ts
const abort = resume_existing ? resume(sessionID) ?? start(sessionID) : start(sessionID)
```
Upstream: `resume_existing ? resume(sessionID) : start(sessionID)` — no fallback if `resume()` returns undefined.

**Title generation (line 1943):** `MessageV2.toModelMessages(...)` made `await`-able.

**Title save (lines 1946–1971):** replaced `Session.setTitle()` call with `Session.update()` draft pattern.

**`ListTool` substitution:** `ReadTool` replaced with `ListTool` for directory listing in context
construction (lines 1209–1217); arg key changed from `filePath` to `path`.

### `provider/transform.ts` — Claude 4.6 adaptive thinking

**Added (lines 339–353):**
```ts
function isClaude46(id: string) { return id.includes("4-6") || id.includes("4.6") }

function claude46Variants(id: string) {
  const variants = {
    low: { thinking: { type: "adaptive" }, effort: "low" },
    medium: { thinking: { type: "adaptive" }, effort: "medium" },
    high: { thinking: { type: "adaptive" }, effort: "high" },
  }
  if (id.includes("opus")) variants.max = { thinking: { type: "adaptive" }, effort: "max" }
  return variants
}
```

Applied in `variants()` for: `@ai-sdk/anthropic`, `@ai-sdk/google-vertex/anthropic`,
`@ai-sdk/amazon-bedrock` (Anthropic models), SAP AI providers.

**Upstream diff:** upstream used inline `model.api.id.includes("opus-4-6")` checks with
`{ thinking: { type: "adaptive" } }` — less general, only handled Opus. OCO handles all 4.6 variants.

**`ProviderTransform.providerOptions()` (line 818):** new exported function routing provider options
through the correct SDK namespace key. For gateway models, routes non-gateway options under
the upstream provider slug (e.g. `anthropic`, `openai`). For other models, uses `sdkKey(npm)`.

**Minor:** TypeScript casts added at lines 77, 101 (`(msg as any).content`) and lines 203–210
(explicit `currentOptions` variable) to comply with AI SDK 6.x stricter types.

### `provider/provider.ts` — AI SDK 6.x type changes

- `LanguageModelV2` → `LanguageModel` (lines 720, 1112) — AI SDK 6.x renamed the type.
- `BUNDLED_PROVIDERS` return type changed from `Record<string, (options: any) => SDK>` to
  `Record<string, (options: any) => any>` (line 60).
- `isGpt5OrLater()` and `shouldUseCopilotResponsesApi()` helper functions added (lines 48–58)
  for Copilot responses API selection logic (GPT-5 and later uses Responses API).
- `aigateway(...)` cast to `any` (line 523) — AI SDK 6.x gateway type mismatch.

### `provider/sdk/openai-compatible/src/` — NEW DIRECTORY

New bundled OpenAI-compatible provider SDK. Contains:
- `index.ts` — exports
- `openai-compatible-provider.ts` — provider factory
- `responses/` — Responses API support for GPT-5+ via Copilot

Not present in upstream 1.2.5 (which had only `provider/sdk/copilot/`).

### Other AI SDK 6.x adapted files (26 files)

The following files have minor adaptations (type imports, API method renames, or test fixture
updates) for AI SDK 6.x compatibility. No functional logic changes beyond what's described above:

| File | Change type |
|------|-------------|
| `session/message-v2.ts` | `LanguageModelV2` → `LanguageModel` type |
| `session/compaction.ts` | Updated `streamText` call options |
| `session/revert.ts` | Token type normalization |
| `session/system.ts` | Minor type adaptation |
| `provider/models.ts` | Model capability field updates |
| `acp/agent.ts` | AI SDK 6.x stream type updates |
| `cli/cmd/tui/routes/session/*.tsx` | Token field access patterns |
| `test/**/*.test.ts` (35 files) | Mock/fixture updates for AI SDK 6.x usage shapes |

---

## Category 3: Bug Fixes

### `cli/cmd/tui/thread.ts` — SIGHUP zombie process fix

**Problem:** Closing the terminal window sends `SIGHUP`. Without a handler, the worker process
(which may hold a `--port` TCP socket) continues running as an orphan.

**Fix (lines 131–136):**
```ts
// Ensure worker shuts down when terminal closes (e.g. window close sends SIGHUP).
// Without this, --port mode leaves an orphan process holding the TCP port.
process.on("SIGHUP", async () => {
  await client?.call("shutdown", undefined).catch(() => {})
  process.exit(0)
})
```

**Additional safety (lines 191–193):** `finally` block:
```ts
await client?.call("shutdown", undefined).catch(() => {})
```

**`client` hoisted** outside the `try` block (line 121 area) so it's accessible in `finally`.

Upstream 1.2.5 has no `SIGHUP` handling.

---

### `cli/cmd/tui/routes/session/header.tsx` — Reasoning token display

**Line 52:** token total excludes reasoning:
```ts
const total = last.tokens.input + last.tokens.output + last.tokens.cache.read + last.tokens.cache.write
```

Upstream included `+ last.tokens.reasoning` — incorrect under AI SDK 6.x where reasoning tokens
are auto-stripped from the usage count before it reaches the app.

---

### `cli/cmd/tui/routes/session/sidebar.tsx` — Reasoning token display

**Line 55:** same fix as `header.tsx` — `reasoning` removed from total calculation.

---

### `session/processor.ts` — Text-delta guard

**Lines 94, 309:** empty text guard added before `updatePart` calls:
```ts
if (part.text) await Session.updatePart({ part, delta: value.text })
```
Upstream wrote empty delta updates which caused unnecessary DB writes and Bus events.

---

### `session/processor.ts` — Text part start time

**Line 330:**
```ts
start: currentText.time?.start ?? Date.now(),
```
Upstream always used `Date.now()`, resetting the start timestamp on each text-delta. This caused
text parts to always show zero duration.

---

### `session/prompt.ts` — Loop resume fallback

**Line 277:**
```ts
const abort = resume_existing ? resume(sessionID) ?? start(sessionID) : start(sessionID)
```
Upstream: `resume(sessionID)` could return `undefined` (if session has no messages), with no fallback.
The `?? start(sessionID)` ensures a fresh start if resume fails.

---

### `plugin/index.ts` — Plugin config hook robustness

**v1.0.31 (lines 146–151):** Each `hook.config?.(config)` call inside `Plugin.init()` is now
wrapped in a try/catch:
```ts
try {
  await hook.config?.(config)
} catch (error) {
  log.error("plugin config hook failed", { error })
}
```
Previously a thrown exception in one plugin's config hook would bubble out of the loop, leaving
all remaining plugins uninitialized. The try/catch isolates each failure so the rest of the
plugin stack still loads.

---

### `packages/ui/src/context/marked.tsx` — Desktop table rendering fix

**v1.0.31 — `renderMathExpressions` rewrite (lines 453–502):** The math expression renderer was
rewritten from a regex-based HTML-splitting approach to a `DOMParser` + `TreeWalker` text-node
strategy. The old implementation applied `$...$` regexes directly over raw HTML strings, which
corrupted table element tags (e.g. `<td class="...">`) when they contained `$` characters.

The new approach:
1. Parses the HTML string into a live DOM: `new DOMParser().parseFromString(html, "text/html")`.
2. Walks only text nodes via `document.createTreeWalker(body, NodeFilter.SHOW_TEXT)`.
3. Skips any text node whose ancestor matches:
   ```ts
   const mathSkippedAncestorSelector =
     "pre, code, kbd, table, thead, tbody, tfoot, tr, th, td, caption"
   ```
4. Replaces math-bearing text nodes in-place with a `DocumentFragment` built from rendered KaTeX.
5. Serializes back to a string with `body.innerHTML`.

Because `<table>` and all its descendants are in the skip-ancestor list, table HTML is never
touched by the math regex, eliminating the corruption.

---

## Category 4: Features

### `cli/cmd/tui/routes/session/header.tsx` — Cache token display

**Lines 52–62:** Displays cache tokens inline with context count:
```ts
const total = last.tokens.input + last.tokens.output + last.tokens.cache.read + last.tokens.cache.write
const cached = last.tokens.cache.read
let result = total.toLocaleString()
if (cached > 0) {
  result += " (Cached " + cached.toLocaleString() + ")"
}
```
Example: `"71,025 (Cached 69,211)"`.

---

### `cli/cmd/tui/routes/session/sidebar.tsx` — Cache token display

**Lines 55–100:** Separate `"69,211 cached"` line in context stats section:
```tsx
<Show when={context()?.cached}>
  <text fg={theme.textMuted}>{context()!.cached} cached</text>
</Show>
```

---

### `skill/discovery.ts` — Skill path validation (security hardening)

**New validators (lines 24–44):**
```ts
function isWithin(root: string, candidate: string): boolean
function normalizeSkillName(name: string): string | undefined
function normalizeSkillFile(file: string): string | undefined
```

**`Index` schema (lines 9–19):** `z.object(...)` with `.min(1)` constraints replaces plain type.

**Applied in `fetch()` (lines 99–133):**
- Skill name validated before creating cache directory.
- Cache path boundary check: `isWithin(cache, root)`.
- `skillBase` URL constructed with proper `baseURL` as origin.
- Each file validated: null bytes, absolute paths, protocol URIs rejected.
- URL boundary check: resolved URL must share `origin` and `pathname` prefix with `skillBase`.
- Destination path boundary check: `isWithin(root, dest)`.

---

### `packages/app/src/context/local.tsx` — Desktop model resolution revamp

**v1.0.32 rewrite:** The `model` state block inside `useLocal` was reworked from imperative
effect-based sync to fully derived computation. Model state no longer lives in a reactive store
that gets reset by `agent.set()` or `agent.move()` — those methods now only update the agent
selection and leave the model untouched.

A single `resolved` memo (lines 148–170) derives the active model by calling the pure helper
`resolveSessionModelSelection()`:
```ts
const resolved = createMemo(() =>
  resolveSessionModelSelection({
    session,         // ephemeral per-session override (set by model.set())
    messages,        // last-user-message model fallback
    revertMessageID,
    agent: currentAgent
      ? { model: currentAgent.model, variant: currentAgent.variant }
      : undefined,
    fallback: fallbackModel(),
    isModelValid,
  })
)
```

Priority order: **session override → last user message model → agent default → fallback**.

`fallbackModel` is a separate memo (lines 125–127) over `providers.connected()`. The
`model.session.set()` helper (line 237) lets external callers push a `SessionModelState`
into the ephemeral store directly, replacing the old `syncSessionModel` effect pattern.

---

### `packages/app/src/pages/session.tsx` — Removed model sync effects

**v1.0.32:** The `syncSessionModel` and `resetSessionModel` `createEffect` blocks and the
`resetSessionModelToken` signal were removed entirely. These effects previously watched session
navigation events and imperatively pushed model state into `local.model`. Under the new derived
model in `local.tsx`, the `resolved` memo recomputes automatically whenever the session route or
message data changes, making the effects redundant.

---

### `packages/app/src/pages/session/session-model-helpers.ts` — NEW FILE

Pure helper for resolving the active model/variant selection for a desktop session. Replaces the
inline `syncSessionModel`/`resetSessionModel` imperative effects that were removed from
`session.tsx`.

**Exported functions:**

`resolveSessionModelSelection(input)` (lines 52–78) — returns `{ model, variant }` using a
strict priority chain:
1. Pending session override (`session.source !== "submit"` and override differs from last message)
2. Last user message's `model` + `variant`
3. Agent default `model` + `variant`
4. Global fallback model

Input type:
```ts
type ResolveSessionModelSelectionInput = {
  session?: SessionModelState        // ephemeral override from model.set()
  messages?: Message[]               // session history for last-user-message lookup
  revertMessageID?: string           // skip messages at or after this ID
  agent?: { model?, variant? }       // agent default
  fallback?: ModelKey                // global fallback
  isModelValid?: (model) => boolean  // provider connectivity guard
}
```

`getLastUserMessage(messages, revertMessageID)` (lines 41–50) — scans history in reverse,
skipping any user message at or after `revertMessageID`.

---

### `packages/app/src/components/session-context-usage.tsx` — Desktop cached token display

**v1.0.32 (lines 92–97):** A conditional cache-read row is added inside the context usage
tooltip, rendered only when `cacheRead > 0`:
```tsx
<Show when={ctx().cacheRead > 0}>
  <div class="flex items-center gap-2">
    <span class="text-text-invert-strong">
      {ctx().cacheRead.toLocaleString(language.intl())}
    </span>
    <span class="text-text-invert-base">cached</span>
  </div>
</Show>
```
Displays the cache-read token count (e.g. `"69,211 cached"`) in the tooltip below the total and
usage-percentage rows. `cacheRead` is sourced from `getSessionContextMetrics()` via the `metrics`
memo already present in the component.

---

## Category 5: External Config (not in `src/`)

These files are not tracked in the source tree but diverge from upstream defaults.

### `oco.jsonc` (user config)

Flat option structure instead of variant system:
```jsonc
{
  "agents": {
    "coder": {
      "thinking": true,
      "effort": "high",
      "reasoningEffort": "high"
    }
  },
  "models": {
    "claude-sonnet-4-6-1m": { ... },
    "claude-opus-4-6-1m": { ... }
  }
}
```
Upstream uses `variant: "high"` which maps through `ProviderTransform.variants()`. OCO passes
options directly to allow adaptive thinking on Claude 4.6 without variant indirection.

---

### `~/.config/oco/prompts/compaction.txt`

Expanded from ~71 lines (upstream default) to ~100 lines.

Additions:
- Self-review pass after initial compaction
- Rules for proactive enrichment (preserve architectural decisions, not just facts)
- Explicit guidance on what NOT to discard (rationale, failed approaches, constraints)

---

## New Test Files

| File | What it tests |
|------|--------------|
| `test/plugin/client-wrapper.test.ts` | `wrapClientForDepthAwareness()` — depth-conditional parentID masking |
| `test/session/depth.test.ts` | `calculateDepth()`, `shouldApplyPruning()`, `shouldApplyPruningForSession()` |
| `test/tool/finish-task.test.ts` | `FinishTaskTool` — parameter validation, parentID requirement |
| `test/tool/task.test.ts` | `TaskTool` — depth computation, singleShot enforcement, orchestrator path |
