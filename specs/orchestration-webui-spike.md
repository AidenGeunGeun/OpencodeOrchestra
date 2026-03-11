# Orchestration WebUI Spike — Structural Design

## Intent
Add orchestration-aware navigation and interaction patterns to the WebUI. This is a structural spike — functional changes only, no visual redesign. The WebUI is currently built for single-agent flat chat. Our system uses a PM → Orchestrator → Subagent hierarchy and the WebUI needs to support navigating that tree, handling cross-session permissions, and showing per-agent context health.

## Context
- Repo: `/home/skybl/projects/agents/OCstuff/OpenCodeOrchestra`
- Frontend: `packages/app/` (SolidJS + Vite + Kobalte + Tailwind)
- UI components: `packages/ui/` (shared component library)
- SDK: `packages/sdk/js/` (API client)
- Server: `packages/opencode/src/server/` (Bun/Hono)
- Baseline commit: `793751e6f` on `main`
- Design philosophy: **Laptop-first** (MacBook browser via Tailscale to home server). Desktop split-panel layout is primary. Mobile is secondary.

## Goals
1. Navigate the PM → Orchestrator → Subagent session tree without losing your place
2. Handle permissions from any depth in the tree without navigating back to PM
3. See per-subagent context window health at a glance

## Part 1: Breadcrumb Navigation + Dive-In

### What to build
- **Breadcrumb bar** in the session view header showing the session hierarchy path
  - Format: `PM › Orchestrator › Investigator` (or just session titles)
  - Each segment is clickable to navigate to that session
  - Only visible when viewing a child/subagent session (not for root sessions)
  - Lives above/alongside the existing session header

- **Clickable task tool cards** in the conversation stream
  - When a `task` tool call appears in a message, clicking it navigates to that subagent's session
  - The task card should show: description, status (running/completed/failed), and a visual "dive in" affordance (arrow, chevron, etc.)
  - This is the primary way to "drill down" into the hierarchy

- **Back navigation** from breadcrumb or browser back button

### How it works (data flow)
- Sessions already have parent/child relationships via `GET /session/:id/children` and session fork data
- The `task` tool call parts contain a `sessionID` for the spawned subagent session
- The breadcrumb needs to walk UP the session tree (child → parent → grandparent) to build the path
- Navigation uses the existing SolidJS router: `/:dir/session/:id`

### Key files to modify
- `packages/app/src/pages/session.tsx` — add breadcrumb component above message area
- `packages/ui/src/components/session-turn.tsx` or `packages/ui/src/components/message-part.tsx` — make task tool cards clickable
- `packages/app/src/context/` — may need a new context or extend existing one to track session hierarchy
- `packages/app/src/pages/session/session-header.tsx` — integrate breadcrumb

### Acceptance criteria
- [ ] Viewing a subagent session shows breadcrumb trail to root
- [ ] Clicking breadcrumb segment navigates to that session
- [ ] Clicking a task tool card in conversation navigates to the subagent session
- [ ] Browser back button returns to previous session
- [ ] Root sessions show no breadcrumb (no visual noise)

## Part 2: Global Permission Overlay

### What to build
- **Permission notification badge** visible from any session
  - Shows count of pending permissions across ALL sessions in the current project
  - Position: fixed, non-intrusive (corner badge or titlebar indicator)
  - Clicking opens a **permission drawer/panel**

- **Permission drawer** listing all pending permissions
  - Groups by session (with session title/path shown)
  - Each permission shows: the request type, the affected file/command, approve/deny/always actions
  - Acting on a permission sends the reply via `POST /permission/:requestID/reply`
  - Drawer closes after last permission is handled, or can be dismissed

### How it works (data flow)
- SSE event stream already emits `permission.asked` and `permission.replied` events
- `GET /permission/` returns all pending permissions
- The WebUI already has permission handling in `packages/app/src/components/question-dock.tsx` and `packages/app/src/pages/session/session-prompt-dock.tsx` — but only for the CURRENT session
- The overlay needs to listen to ALL permission events regardless of which session is being viewed
- Use the **global event stream** (`GET /global/event`) or the instance event stream (`GET /event`) which already covers all sessions for the current project

### Key files to modify
- `packages/app/src/context/` — new `PermissionOverlayProvider` or extend global-sync to track all permissions
- `packages/app/src/components/` — new `permission-overlay.tsx` component
- `packages/app/src/pages/layout.tsx` — mount the overlay at layout level (above session routing)

### Acceptance criteria
- [ ] Badge shows pending permission count from ALL sessions
- [ ] Badge visible regardless of which session is being viewed
- [ ] Clicking badge opens drawer with all pending permissions grouped by session
- [ ] Can approve/deny/always directly from the drawer
- [ ] Badge count updates in real-time via SSE
- [ ] When viewing the session that has the permission, both the inline dock AND the overlay show it (no conflict)

## Part 3: Context Health Indicators

### What to build
- **Per-session context indicator** showing current tokens vs model max
  - Visible in: breadcrumb (for current hierarchy), session list sidebar, task tool cards
  - Format: compact bar or fraction like `90K / 200K` with color coding (green/yellow/red)
  - Thresholds: green < 50%, yellow 50-80%, red > 80%

- **Existing data**: The prompt dock already shows tokens/usage/cost. This extends that data to be visible in MORE places:
  - Breadcrumb segments show a small indicator for each ancestor session
  - Task tool cards show the subagent's context health
  - Session sidebar items could show context health

### How it works (data flow)
- `GET /session/status` returns `Record<string, SessionStatus.Info>` — this likely includes token counts
- SSE `session.status` events provide real-time updates
- Model max context comes from provider/model data
- The `session-header.tsx` in TUI already shows: cost, context tokens, cache, context % — same data, different placement

### Key files to modify
- `packages/app/src/components/` — new `context-health.tsx` small component
- Integrate into breadcrumb, task tool cards, and optionally session sidebar

### Acceptance criteria
- [ ] Current session shows context health in a visible location
- [ ] Breadcrumb segments show context health for ancestor sessions
- [ ] Task tool cards show subagent context health when running
- [ ] Color coding indicates health (green/yellow/red)
- [ ] Data updates in real-time via SSE

## Out of Scope
- Visual redesign, new color scheme, animation overhaul
- Mobile-specific layout changes (drawers, gestures)
- Command palette fix
- Any changes to the server/backend
- Any changes to the TUI

## Verification
1. `bun install` succeeds
2. `bunx turbo typecheck` passes
3. `bun test --filter opencode` — 894+ pass, 0 fail
4. `bun run --cwd packages/app build` succeeds
5. Manual smoke test: start server, open WebUI, create a session, trigger subagent work, verify breadcrumbs appear, permissions show in overlay, context health visible
6. Existing functionality not broken: regular chat, file tree, terminal, settings all work

## Risks
- Session parent/child relationship data may not be readily available in the SDK response — may need to derive from task tool call parts
- `GET /session/status` response shape needs verification for token/context data
- The global permission overlay may conflict with the per-session permission dock — need to handle both gracefully
- Task tool card click behavior needs to not conflict with existing expand/collapse behavior
