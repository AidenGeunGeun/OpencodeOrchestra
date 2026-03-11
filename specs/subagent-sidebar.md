# Subagent Sidebar

## Intent
Add a "Subagents" tab to the right side panel that shows direct child sessions of the currently viewed session. This gives orchestration visibility — PM sees its orchestrators, orchestrators see their investigators/auditors — without flattening the whole tree.

## Context
- The right side panel (`session-side-panel.tsx`) has a tab system: Review, Context, file tabs
- The server already exposes `GET /session/{sessionID}/children` returning `Session[]` (direct children only)
- The SDK has `sdk.client.session.children({ sessionID })`
- SSE events include `session.created` and `session.updated` for real-time updates
- `ContextHealth` component exists at `@opencode-ai/ui/context-health`
- Session type has: `id`, `title`, `agentID`, `parentID`, `time.created/updated`
- The sync store in `packages/app/src/context/sync.tsx` handles SSE subscription

## Goals
1. Show direct child sessions (depth -1 only) in a sidebar tab
2. Each child shows: title, agent type, running/done status, context health, click-to-navigate
3. Real-time: new subagents appear as they're spawned
4. Tab only shown when viewing a session (not on the home/project page)

## Acceptance Criteria
1. A "Subagents" tab appears in the right side panel tab bar
2. The tab lists direct children of the current session fetched via `session.children` SDK method
3. Each entry displays:
   - Session title (truncated if long)
   - Agent type derived from `agentID` field (e.g., "orchestrator", "investigator", "auditor")
   - Status indicator: running (spinner or pulse dot) vs completed (check) vs failed (x)
   - Context health badge (reuse existing `ContextHealth` component)
4. Clicking an entry navigates to that child session (same as breadcrumb/task card navigation)
5. List updates in real-time when new child sessions are created (via SSE `session.created` events)
6. When the current session has no children, show a minimal empty state (not a blank void)
7. Tab count badge shows number of children (like Review tab shows change count)

## Changes Required

### New file: `packages/app/src/components/subagent-list.tsx`
- Component that takes `sessionID` prop
- Fetches children via `sdk.client.session.children({ sessionID })`
- Subscribes to SSE events to detect new children in real-time (or re-fetches on `session.created`)
- Renders list of child sessions with title, agent badge, status, context health
- Each item is clickable → navigates to child session
- Empty state when no children

### Modified: `packages/app/src/pages/session/session-side-panel.tsx`
- Add "Subagents" tab trigger in the tab bar (after Review, before Context)
- Add `Tabs.Content` for the subagents tab rendering `SubagentList`
- Accept new props: `sessionID`, `onNavigateSession`, `childCount`
- Show count badge on tab trigger (like Review tab does)

### Modified: `packages/app/src/pages/session.tsx`
- Fetch child sessions for the current session
- Pass `sessionID`, `onNavigateSession`, `childCount` to `SessionSidePanel`
- Subscribe to session events to refresh child count

## Deriving Status
- **Running**: Session exists but has no final assistant message with `finish` set, OR the session's latest message is still streaming
- **Completed**: Session has a final assistant message with `finish` reason
- **Failed**: Session has an error state
- Simplest approach: check `time.updated` recency + whether session appears in active subscriptions. Or just use a simple heuristic — if the session was updated in the last few seconds, it's likely running.
- Alternative: The sync store may already track which sessions are "active". Investigate `sync.session` for status signals.

## Out of Scope
- Nested subagent tree (showing children of children) — only direct children
- Drag-and-drop reordering of the subagent list
- Filtering or searching subagents
- Subagent creation from the sidebar

## Test Cases
- View PM session → sidebar shows orchestrator children
- View orchestrator session → sidebar shows investigator/auditor children  
- View leaf session (no children) → sidebar shows empty state
- Spawn a new subagent → it appears in the list without page refresh
- Click a subagent → navigates to that session, breadcrumbs update
- Tab badge shows correct child count

## Verification
1. `bunx --bun tsc --noEmit` passes
2. `bun run --cwd packages/app build` succeeds
3. Manual smoke test: navigate to a PM session with subagents, verify sidebar tab appears with children listed
