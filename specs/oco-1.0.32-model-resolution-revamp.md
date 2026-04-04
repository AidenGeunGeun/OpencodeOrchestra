# OCO 1.0.32 — Desktop Model Resolution Revamp

## Problem

The desktop app's model/variant state management has multiple competing stores and effects that race against each other on session navigation. The result: switching projects or sessions resets the model to the agent default instead of showing what was actually last used.

## Solution

Replace the entire sync/effect-based model resolution with a single derived computation. No stores, no syncing, no effects fighting each other.

### Model Resolution Rule

When a session is opened in the desktop app, the displayed model and thinking effort are determined by exactly one rule:

1. **Session has messages?** → Use the most recent user message's `model` (providerID + modelID) and `variant` (which encodes provider-specific parameters like thinking effort). This is the source of truth — it reflects exactly what parameters the model was last called with.

2. **Session has no messages?** (brand new session) → Use the agent's configured default from `oco.jsonc`. If even that is absent, fall back to the system default (first connected provider's default model).

That's it. No intermediate state. No per-agent ephemeral store. No global variant store lookups.

### What To Remove

In `packages/app/src/pages/session.tsx`:
- Remove the `syncSessionModel` effect entirely (the one watching `params.id` + `messagesReady` + `lastUserMessage`)
- Remove the `resetSessionModel` effect entirely (the one watching `params.dir` + `params.id`)
- Remove the `resetSessionModelToken` variable
- Remove imports of `syncSessionModel` and `resetSessionModel`

In `packages/app/src/context/local.tsx`:
- In `agent.set()`: remove the `setModel()` call and the `models.variant.set()` call. Agent switching should only change which agent is active, NOT reset the model. Keep only `setStore("current", value.name)`.
- Same for `agent.move()`: remove the `setModel()` and `models.variant.set()` calls.
- Remove `ephemeral.model` from the ephemeral store (the per-agent-name model memory). Only `ephemeral.session` is needed — and even that is only for the case where the user manually changes the model before sending a message.

### What To Change

In `packages/app/src/context/local.tsx`, rewrite `model.current()`:

The memo should derive the model directly from session data:
1. Check if there's a user override in `ephemeral.session[sessionID]?.model` (user changed model in UI but hasn't sent a message yet — this is the ONLY state we keep)
2. If not, find the last user message for the current session from `sync.data.message[sessionID]` and use its `model`
3. If no messages exist, use `agent.current()?.model` (agent default from config)
4. If no agent model, use `fallbackModel()` (system default)

Rewrite `variant.selected()` and `variant.current()`:

Same derivation:
1. Check `ephemeral.session[sessionID]?.variant` (user override)
2. If not, use the last user message's `variant`
3. If no messages, use the agent's configured variant
4. If nothing, `undefined`

In `model.set()` (called when user manually picks a model in the UI):
- Write to `ephemeral.session[currentSessionID()]` only. This is the "user changed model but hasn't sent a message yet" override.
- Do NOT write to `ephemeral.model[agentName]` (that store should not exist anymore).

In `variant.set()` (called when user changes thinking effort):
- Write to `ephemeral.session[currentSessionID()]` only.

### What NOT To Change

- `packages/opencode/src/` — server-side is untouched. Messages already store model+variant correctly.
- `agent.ts` — the `effort → variant` mapping from Fix 1 stays.
- The TUI — it manages its own model state differently and works fine.
- `session-model-helpers.ts` — can be deleted or emptied. Its functions are no longer needed.

## Files

- `packages/app/src/context/local.tsx` — main changes
- `packages/app/src/pages/session.tsx` — remove effects
- `packages/app/src/pages/session/session-model-helpers.ts` — remove or empty

## Acceptance Criteria

- Switch projects in sidebar → auto-loaded session shows the model+variant from its last user message, not the agent default.
- Navigate between sessions → each session shows its own last-used model+variant.
- New session (no messages) → shows agent default model+variant from config.
- User changes model in UI → reflected immediately. After sending a message, that message becomes the new source of truth.
- No regressions: model picker, variant/thinking effort picker, agent switching all still work.

## Verification

- `bun run typecheck` in `packages/app`
- `bun test --preload ./happydom.ts` in `packages/app` for any existing tests
- Manual: open desktop dev app, switch between projects and sessions, verify model+variant are correct.
