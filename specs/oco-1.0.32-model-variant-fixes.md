# OCO 1.0.32 — Desktop Model/Variant Persistence Fixes

**Scope:** Three related fixes for desktop model and variant state management. All stem from the same investigation of why "Default" shows instead of the configured thinking effort on session/project switches.

---

## Fix 1 — `effort` field not mapped to `variant` in agent config resolution

**Problem:** In `oco.jsonc`, agent config uses `"effort": "max"` to set the default thinking level. The server-side agent resolution in `agent.ts` only reads `value.variant`, ignoring `effort` entirely. The `effort` field is a provider-level concept defined inside variant option objects in `provider/transform.ts` (e.g. variant `"max"` maps to `{ thinking: { type: "adaptive" }, effort: "max" }`). When the user writes `effort: "max"` in their agent config, the server sets `agent.variant = undefined`, and the desktop app shows "Default" instead of "max".

The TUI may handle this differently or not surface it visually, which is why it only shows in the desktop.

**Fix:** In `packages/opencode/src/agent/agent.ts`, in the config merge loop where agent properties are assigned from user config, add a fallback: if `value.variant` is not set but `value.effort` is, use `value.effort` as the variant. This makes `effort` an alias for `variant` in agent config, which matches user expectations since the variant keys (`low`, `medium`, `high`, `max`) map 1:1 to effort levels.

The line to change is approximately:
```
item.variant = value.variant ?? item.variant
```
Should become equivalent to:
```
item.variant = value.variant ?? value.effort ?? item.variant
```

**Files:** `packages/opencode/src/agent/agent.ts`

---

## Fix 2 — Session model state not initialized on session entry via project switch

**Problem:** When switching projects in the desktop sidebar, `navigateToProject` loads the most recent session for that project. On arrival, `ephemeral.session[newSessionID]` is empty (never visited this app session), so the model resolution in `local.tsx` falls through to the agent default instead of restoring from the session's last user message.

`syncSessionModel` is responsible for populating `ephemeral.session`, but it only fires when `lastUserMessage()?.id` changes. On project switch, the session data may still be loading when the effect evaluates, or the reactive dependency doesn't trigger because the memo hasn't resolved yet.

**Fix:** In `packages/app/src/pages/session.tsx`, add a secondary initialization path. When `params.id` changes to a new session that has messages, eagerly call `syncSessionModel` with the last user message from that session. This should be an additional effect that watches `params.id` combined with the session's message data availability, separate from the existing `lastUserMessage()?.id` watcher.

Alternatively, modify the existing `lastUserMessage` effect to be more reactive to session switches — ensure it fires on `params.id` change even if the message ID itself is technically new (since it's a different session's message).

**Files:** `packages/app/src/pages/session.tsx`

---

## Fix 3 — `variant.selected()` returns `undefined` too eagerly for active sessions

**Problem:** In `local.tsx` (line 280-288), `variant.selected()` has this logic:

```ts
const session = sessionState(sessionID)
if (sameModel(session?.model, key)) return session?.variant
if (sessionID) return undefined  // problem: active session with no session state yet → undefined
return models.variant.get(key)
```

When a session is active (`sessionID` is set) but `sessionState` hasn't been populated yet (Fix 2's scenario), the function returns `undefined` instead of falling through to the global variant store or the configured agent variant. This causes `resolveModelVariant` to receive `selected: undefined`, and if `configured` is also `undefined` (Fix 1's scenario), the result is `undefined` → "Default".

**Fix:** When `sessionState` returns no data for the current session (i.e. the session hasn't been visited yet this app session), don't immediately return `undefined`. Instead, fall through to check the global variant store (`models.variant.get(key)`) or let `configured` take over. The guard `if (sessionID) return undefined` is too aggressive — it should only return `undefined` if there IS session state but the model doesn't match, not when session state is completely absent.

**Files:** `packages/app/src/context/local.tsx`

---

## Acceptance Criteria

- An agent configured with `effort: "max"` in `oco.jsonc` shows "max" (not "Default") as the thinking effort in the desktop app on fresh session load.
- Switching projects in the sidebar preserves the correct model AND variant for the auto-loaded session.
- Navigating between sessions within the same project preserves model and variant (existing 1.0.31 behavior, no regression).
- New sessions with no messages still default to the agent's configured model and variant.
- TUI behavior unchanged (no regression).

## Verification

- Desktop dev app: switch projects, verify model and thinking effort are correct for the loaded session.
- Desktop dev app: check that a build agent session shows "max" thinking effort by default, not "Default".
- `bun run typecheck` in `packages/opencode` and `packages/app`.
