## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `bun dev web` (i.e., `oco dev web`) proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## SSE Event System & Sync

The Desktop receives real-time updates from the server via SSE (Server-Sent Events). The flow is:

```
Server Bus.publish() → GlobalBus.emit() → SSE stream
    → global-sdk.tsx (event loop) → queue → flush → emitter
    → global-sync.tsx (applyDirectoryEvent) → reactive store → UI
```

**Event reducer** (`src/context/global-sync/event-reducer.ts`) handles: `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`, `message.part.delta`, `session.created`, `session.updated`, `session.deleted`, `session.status`, `todo.updated`, and more.

**Heartbeat**: Desktop times out after 15s of no events (`HEARTBEAT_TIMEOUT_MS` in `global-sdk.tsx`). Server must send heartbeats faster than this (currently 10s). If the server heartbeat is >= 15s, the SSE connection drops and reconnects in a loop, missing events.

### sync.session.sync() Caching

`sync.session.sync(sessionId)` in `src/context/sync.tsx` checks if messages are already cached:

```typescript
const cached = store.message[sessionID] !== undefined && meta.limit[key] !== undefined
if (cached && hasSession && !opts?.force) return  // ← early return, no fetch
```

**Always use `{ force: true }` when you know server-side data has changed** (e.g., after plugin commands, after server-side message creation). Without `force`, the function returns immediately because the session is already cached.

### Command Handler Sync

After `client.session.command()` returns (even HTTP 204 from sentinel-handled plugin commands), the Desktop MUST call `sync.session.sync(session.id, { force: true })`. Plugin commands like `/compress manage` create messages server-side that don't appear in the Desktop cache until explicitly fetched.

## Agent Selector & session.agentID

Sessions can have an `agentID` field (set for subagent sessions). When viewing a child session:

- **Display**: Show `session.agentID` in the agent selector, not `local.agent.current()`
- **Disable**: Lock the selector — don't allow cycling
- **Submit**: Use `session.agentID` for the `agent` field in prompt/command requests
- **Model sync**: Model resolution is derived from the last user message's model field — `syncSessionModel` no longer exists. Session model is derived in `context/local.tsx` via `resolveSessionModelSelection()` from `session-model-helpers.ts`.

The TUI does this via `effectiveAgent()` in `prompt/index.tsx` and lock checks in `app.tsx`. Desktop mirrors this in `prompt-input.tsx` (selector), `submit.ts` (submission), `use-session-commands.tsx` (cycling), and `context/local.tsx` + `session-model-helpers.ts` (model derivation).

If this is broken, the Desktop shows "build" for all sessions and model/thinking changes get applied to the wrong agent.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Agent Visual Check

- Run `bun run --cwd packages/app visual-check` after any task changing visible UI, animations, panels, browser comments, subagents, review UI, Tool Dock behavior, or desktop shell behavior.
- The workflow uses the sandboxed local e2e backend, so it should not write to real user app data and does not require provider secrets or external services.
- Artifacts are written under `/tmp/oco-visual-check-*`: one screenshot and structured state JSON per restored Tool Dock tab, `tool-dock-shrink.png`, `shrink.state.json`, and `summary.json`.
- Today it checks the Tool Dock Review, Subagents, and Browser tabs, defaults to Subagents when a child session exists, shrinks from a wide saved-layout viewport to laptop width, restores hidden Review/Browser after the shrink, and fails on inactive visible content, hidden active content, wrong selected tab, dock out-of-bounds, or horizontal document overflow.
- V1 uses the reliable app web renderer with a test-only desktop fallback so the Browser tab can render; it does not yet automate the packaged Electron shell.
