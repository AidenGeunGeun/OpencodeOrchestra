# OCO 1.1.0 — Targeted Upstream Sync

**Scope:** Six surgical fixes — five cherry-picked from upstream v1.3.x, one OCO-specific desktop rendering bug. No Effect service refactor, no TUI plugin system, no sidebar restructure. Each fix is independent and can be verified in isolation.

---

## Fix 1 — Desktop: Session model selection does not persist across navigation

**Problem:** In the desktop app, navigating away from a session and back resets the model to the agent's configured default. If you manually switch from Opus 4.6 to Sonnet 4.6 in a PM session, it reverts on every navigation. The thinking level resets with it.

**Root cause:** Two places in the desktop app:

1. `packages/app/src/pages/session/session-model-helpers.ts` — `resetSessionModel()` is called whenever route params change (nav away). It unconditionally sets `local.model` and `local.model.variant` back to the current agent's config defaults. There is no concept of a per-session override.

2. `packages/app/src/context/local.tsx` — The ephemeral model store is keyed by agent name (`ephemeral.model[agentName]`), not session ID. So all PM sessions share one slot; navigating to any PM session loads the same (just-reset) agent default.

**Fix:** Store the user's model choice per session ID in the desktop app's local context. When navigating to a session that has a stored override, restore it instead of falling back to the agent default. When navigating to a brand-new session with no history and no stored override, fall back to the agent default as today. `resetSessionModel` should only fire when truly appropriate (e.g. landing on the home screen with no session selected), not on every session-to-session transition.

The upstream partial fix (#17470) addressed only the agent-switching path in a different component (`packages/app/src/context/local.tsx` `agent.set()`), not the session navigation path. OCO's fix needs to go further.

**Files:** `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/session-model-helpers.ts`, `packages/app/src/context/local.tsx`

---

## Fix 2 — Subagents not clickable while loading (pending status)

**Problem:** In the parent session's message timeline, task tool parts that represent subagent sessions are not clickable while the subagent is still starting up. A user sees the subagent entry but clicking does nothing. Only starts working once the subagent transitions from `"pending"` to `"running"`.

**Root cause:** `packages/opencode/src/session/prompt.ts` — inside the task tool's Bus event handler, there is a guard:

```ts
if (!match || match.state.status !== "running") return
```

Task parts begin in `"pending"` state before the session starts executing. The guard excludes `"pending"`, so the click handler bails out during that window. On slow machines this window is wide enough to be consistently reproducible.

**Fix:** Extend the guard to include both statuses:

```ts
if (!match || !["running", "pending"].includes(match.state.status)) return
```

This is a verbatim one-line cherry-pick from upstream commit `befbedacd` (#20263). Apply it to the equivalent location in OCO's `session/prompt.ts`. The location must be found by context since OCO's `prompt.ts` has diverged from upstream's effectified version — look for the Bus event handler inside the task tool execution path that checks `match.state.status`.

**Files:** `packages/opencode/src/session/prompt.ts`

---

## Fix 3 — Todowrite deny should be conditional on agent permission config

**Problem:** In `task.ts`, `todowrite` is unconditionally denied for every spawned subagent session, regardless of what the agent's permission config says. This is hardcoded in two places: the session `permission` array and the `tools` block passed to `SessionPrompt.prompt`.

**Current OCO code (task.ts ~line 124):**
```ts
permission: [
  { permission: "todowrite", pattern: "*", action: "deny" },
  { permission: "todoread",  pattern: "*", action: "deny" },
  ...
]
```
And in the tools block:
```ts
tools: {
  todowrite: false,
  todoread: false,
  ...
}
```

**Why it matters:** All current OCO agents deny todowrite in their config, so behavior is unchanged today. But this hardcode makes it impossible to ever give a specific subagent intentional todo access — future per-agent todo list support (planned for 1.2.0) depends on this being conditional.

**Fix:** Mirror upstream commit `66a56551b` (#19125). Before creating the session, check whether the agent's permission config explicitly grants `todowrite`. Only inject the deny rules if no explicit grant exists. Same conditional logic for the `tools` block. The pattern already exists in OCO's `task.ts` for the `task` permission (`hasTaskPermission` check) — apply the same pattern for `todowrite` and `todoread`.

**Files:** `packages/opencode/src/tool/task.ts`

---

## Fix 4 — Agent object passed to plugin hooks instead of agent name string

**Problem:** The `chat.params` and `chat.headers` plugin hooks in `session/llm.ts` pass `input.agent` (the full agent config object) as the `agent` field. The hook contract specifies `agent` as a string (the agent name). Any plugin relying on `agent` to identify which agent is running receives an object and crashes or silently misbehaves.

**Fix:** Verbatim cherry-pick from upstream commit `9f3c2bd86` (#19996). Change both hook invocations in `packages/opencode/src/session/llm.ts` from `agent: input.agent` to `agent: input.agent.name`. OCO's `llm.ts` still has the original bug at lines 122 and 141.

**Files:** `packages/opencode/src/session/llm.ts`

---

## Fix 5 — Plugin system robustness: agent/command resolution and async error handling

**Problem:** Several silent failure modes in the plugin/session pipeline:

- If an agent name passed to `SessionPrompt.prompt` doesn't resolve (e.g. typo in config, race during init), `Agent.get()` returns undefined and execution continues with a null agent, producing cryptic downstream errors with no indication of the actual cause.
- Plugin `config` hooks that throw are unhandled — one bad plugin silently kills config propagation for all subsequent plugins.
- Command not found errors don't surface the list of available commands, making debugging hard.

**Fix:** Cherry-pick from upstream commit `814a515a8` (#18280), applied to OCO's versions of the affected files. Three targeted changes:

1. **`plugin/index.ts`** — Wrap the `config` hook call in a try/catch that logs the error and continues, so one plugin failure doesn't break the rest.

2. **`session/prompt.ts`** — Add explicit null-checks after every `Agent.get()` call in the prompt pipeline (at minimum: `createUserMessage`, the main loop agent resolution, task agent resolution, compaction agent resolution). On null, publish a `Session.Event.Error` to the Bus with a human-readable message listing available agents, then throw. OCO's `prompt.ts` already has one such check (line 1856) — extend the same pattern to the other `Agent.get()` callsites that currently proceed unchecked (lines 430, 572, 968, 1522).

3. **`server/routes/session.ts`** — Apply the same error-with-hint pattern to command resolution.

**Files:** `packages/opencode/src/plugin/index.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/server/routes/session.ts`

---

## Fix 6 — Desktop: HTML table tags rendered as visible text in message content

**Problem:** In the desktop app, tables output by models — especially those containing prices, currency symbols, or mixed-language content with inline HTML (`<strong>`, `<td>`, etc.) — render with raw HTML tags visible as text instead of being parsed. The table structure breaks and tags like `< /td >< td >< strong >` appear literally in the output.

**Root cause:** The desktop markdown rendering pipeline is:

```
comrak (Rust) → renderMathExpressions → highlightCodeBlocks → DOMPurify → DOM
```

The two post-processing functions (`renderMathExpressions` and `highlightCodeBlocks` in `packages/ui/src/context/marked.tsx`) use regex to split HTML and selectively process parts. These regexes are not HTML-aware and can corrupt the HTML structure:

1. `renderMathExpressions` (line 411-424) splits on `<pre|code|kbd>` tags using `(<(?:pre|code|kbd)[^>]*>[\s\S]*?<\/(?:pre|code|kbd)>)` to avoid processing code blocks. Everything outside matched code blocks gets passed through `renderMathInText`, which runs inline math regexes (`$...$` and `$$...$$`) over raw HTML strings. If table content contains `$` characters (currency), or if the regex split fragments the HTML at wrong boundaries, the math replacement corrupts surrounding HTML tags.

2. When corrupted/malformed HTML reaches `DOMPurify.sanitize()`, DOMPurify strips the broken tags or converts them to text, producing the visible `< /td >< strong >` artifacts.

3. This is desktop-only because the desktop app uses the native `comrak` parser branch (line 498-506) which applies these regex post-processors. The TUI uses its own terminal renderer. The JS `marked` parser branch (used in web) handles math/code via proper marked extensions that process at the AST level before HTML generation.

**Fix:** Make `renderMathExpressions` HTML-safe. Instead of using regex to split on code/pre/kbd tags and then running math regexes over raw HTML (which contains `<td>`, `<strong>`, etc.), parse the HTML into a DOM tree and only process text nodes that are not inside `pre`, `code`, or `kbd` elements. This prevents the math regex from ever seeing or corrupting HTML tags.

The `highlightCodeBlocks` regex is less likely to cause this specific issue (it matches a very specific `<pre><code>...</code></pre>` pattern), but if it does contribute, the same DOM-based approach should be applied.

**Files:** `packages/ui/src/context/marked.tsx`

---

## Acceptance Criteria

- Switching between PM sessions in the desktop app preserves the manually selected model and thinking level for each session.
- A new session with no history defaults to the agent's configured model as before.
- Clicking a subagent task part while it is in `"pending"` state navigates to the subagent session correctly.
- Spawning a subagent whose agent config has no explicit `todowrite` permission still denies todo access (existing behavior preserved).
- Plugin `chat.params` and `chat.headers` hooks receive `agent` as a string.
- A session prompt call with an unresolvable agent name produces a clear error message on the Bus listing available agents, rather than a silent null-dereference crash.
- A plugin whose `config` hook throws does not prevent other plugins from receiving config updates.

## Verification

- Desktop app: start two PM sessions, manually change model in session A to something other than the default, switch to session B, switch back — model in session A should be unchanged.
- TUI: no regression in model selection behavior (effects fire once on mount and don't re-trigger on navigation, so no change expected).
- Subagent clickability: run a task that spawns a subagent, click the task part immediately on a slow connection or add an artificial delay — should navigate to the subagent session.
- Tables with currency symbols, inline HTML, or mixed-language content render correctly in the desktop app — no raw HTML tags visible as text.
- Math expressions (`$...$`, `$$...$$`) still render correctly in non-table content.
- Code blocks with syntax highlighting still work correctly.
- `bun test` suite passes with no new failures.
