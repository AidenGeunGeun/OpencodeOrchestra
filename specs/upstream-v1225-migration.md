# Upstream v1.2.24 Migration — Execution Spec

## Intent

Replace our divergent `packages/app`, `packages/ui`, and `packages/sdk` with upstream v1.2.24 versions wholesale. Restore `packages/desktop` (Tauri app). Port workspace feature into `packages/opencode`. Re-apply Orchestra-specific frontend features on top. Discard all custom animation work (upstream has it polished now).

## Context

- Fork base: upstream opencode v1.2.5
- Upstream tag: `v1.2.24` (stable, 2026-03-09) — chosen over v1.2.25 which has reported breakage
- v1.2.24 contains all animation polish: Animation Smorgasbord, sidebar reveal, all panels transition, review panel transition, dock animation delay
- Our custom animation system, convention pass, and duration tuning are all being replaced by upstream's work
- Upstream frontend now uses `workspace` extensively (125+ references in app) — requires server-side workspace support
- Desktop app (Tauri) supports remote HTTP server connections out of the box — ideal for Tailscale `oco serve` workflow

## Scope

### Part 1: Clean Slate

**Goal**: Discard custom frontend packages. (Checkpoint commit already done at `808f46b49`.)

1. **Delete** directories:
   - `packages/app/` (will be replaced wholesale)
   - `packages/ui/` (will be replaced wholesale)
   - `packages/sdk/` (will be replaced wholesale)

### Part 2: Restore Frontend Packages from Upstream

**Goal**: Copy `app`, `ui`, `sdk`, `desktop` from v1.2.24.

1. **Extract from v1.2.24**:
   - `packages/app/` — full directory
   - `packages/ui/` — full directory
   - `packages/sdk/` — full directory
   - `packages/desktop/` — full directory (new)
2. **Method**: `git checkout v1.2.24 -- packages/app packages/ui packages/sdk packages/desktop`
3. **Do NOT extract**: console, containers, desktop-electron, docs, enterprise, extensions, function, identity, slack, storybook, web — none of these are needed
4. **Version alignment**: Update `version` field in `packages/app/package.json`, `packages/ui/package.json`, `packages/sdk/js/package.json`, `packages/desktop/package.json` to match `packages/opencode/package.json` version (currently `1.0.9`; will become `1.0.10` at release)

### Part 3: Workspace Feature — Server-Side

**Goal**: Add workspace support to `packages/opencode` so the upstream frontend's workspace UI works.

1. **Copy control-plane directory** from v1.2.24:
   ```
   git checkout v1.2.24 -- packages/opencode/src/control-plane/
   ```
   Files (10 — no `schema.ts` in v1.2.24):
   - `adaptors/index.ts`, `adaptors/worktree.ts`
   - `types.ts`, `sse.ts`
   - `workspace-context.ts`, `workspace-router-middleware.ts`
   - `workspace-server/routes.ts`, `workspace-server/server.ts`
   - `workspace.sql.ts`, `workspace.ts`

2. **Copy workspace route**:
   ```
   git checkout v1.2.24 -- packages/opencode/src/server/routes/workspace.ts
   ```

3. **Copy 3 new DB migrations** (v1.2.24 has 3, not 5 — no account tables):
   ```
   git checkout v1.2.24 -- \
     packages/opencode/migration/20260225215848_workspace \
     packages/opencode/migration/20260227213759_add_session_workspace_id \
     packages/opencode/migration/20260303231226_add_workspace_fields
   ```

4. **Wire workspace into server.ts** — apply the upstream v1.2.24 changes to `packages/opencode/src/server/server.ts`:

   a. Add 2 imports (after existing imports, before `globalThis.AI_SDK_LOG_WARNINGS`):
   ```typescript
   import { WorkspaceContext } from "../control-plane/workspace-context"
   import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
   ```
   Note: v1.2.24 does NOT use branded `WorkspaceID` — workspaceID is a plain string.

   b. Add `Filesystem` import:
   ```typescript
   import { Filesystem } from "@/util/filesystem"
   ```

   c. Replace the Instance middleware (currently lines ~225-242) with workspace-wrapped version:
   ```typescript
   .use(async (c, next) => {
     if (c.req.path === "/log") return next()
     const workspaceID = c.req.query("workspace") || c.req.header("x-opencode-workspace")
     const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
     const directory = Filesystem.resolve(
       (() => {
         try {
           return decodeURIComponent(raw)
         } catch {
           return raw
         }
       })(),
     )
     return WorkspaceContext.provide({
       workspaceID,
       async fn() {
         return Instance.provide({
           directory,
           init: InstanceBootstrap,
           async fn() {
             return next()
           },
         })
       },
     })
   })
   ```

   d. Add `WorkspaceRouterMiddleware` after the Instance middleware:
   ```typescript
   .use(WorkspaceRouterMiddleware)
   ```

   e. Add `workspace` to query validator alongside `directory`:
   ```typescript
   .use(validator("query", z.object({ directory: z.string().optional(), workspace: z.string().optional() })))
   ```

5. **Check for Filesystem import**: Upstream uses `Filesystem.resolve()` for directory. Our current code uses inline `decodeURIComponent`. Check if `@/util/filesystem` exists in our codebase and has `resolve()` — if not, copy it from upstream v1.2.24.

### Part 4: Root Configuration

**Goal**: Update monorepo config for the new package set.

1. **Root `package.json`**:
   - Keep existing `workspaces.packages` as `["packages/*", "packages/sdk/js"]` (desktop is already under `packages/*`)
   - Compare `catalog` entries with upstream v1.2.24 — add any new entries needed by desktop/app/ui (Tauri plugins, new deps)
   - Ensure `devDependencies` includes anything new desktop needs

2. **`turbo.json`**:
   - Update `build.dependsOn` from `["^build"]` to `[]` (matches upstream — prevents circular build deps)
   - Add `globalEnv` and `globalPassThroughEnv` for `CI` and `OPENCODE_DISABLE_SHARE`
   - Add per-package test overrides if upstream has them

3. **Run `bun install`** to regenerate lockfile

### Part 5: Re-Apply Orchestra Frontend Features

**Goal**: Layer our orchestration features back onto the upstream frontend.

**New files to create** (copy from git history at commit `a1fa4a5aa`):
1. `packages/app/src/components/permission-overlay.tsx`
2. `packages/app/src/pages/session/session-breadcrumb.tsx`
3. `packages/app/src/components/subagent-list.tsx`
4. `packages/ui/src/components/context-health.tsx`

**Surgical edits to upstream files** — these must be adapted to the v1.2.24 code since the base files have changed significantly:

5. `packages/app/src/pages/layout.tsx` — mount `<PermissionOverlay />` at layout level
6. `packages/app/src/pages/session.tsx` — add breadcrumb ancestry tracking, `navigateToSession()` with `inferNavigationDirection()`, `sessionBreadcrumbs` memo, context health per session, child session data for subagent sidebar
7. `packages/app/src/pages/session/message-timeline.tsx` — render `<SessionBreadcrumb>` in header, pass breadcrumb/context data
8. `packages/app/src/pages/session/session-side-panel.tsx` — add Subagents tab with count badge, wire `<SubagentList>`
9. `packages/ui/src/components/message-part.tsx` — make task tool cards clickable with navigation callback, show context health
10. `packages/ui/src/components/basic-tool.tsx` — expose navigation trigger on task tool render
11. `packages/ui/src/context/data.tsx` — expose `provider` data for context health token calculations

**Important**: The upstream v1.2.24 files have changed substantially from v1.2.5. The Orchestra edits MUST be adapted to the new file structure — do NOT blindly apply old diffs. The investigator/orchestrator must read the v1.2.24 versions of each target file, understand the current structure, and integrate Orchestra features at the correct locations.

### Part 6: Build & Verify

1. `bun install` — must succeed
2. `bun turbo typecheck` — all packages must pass
3. `bun run --cwd packages/app build` — frontend must build
4. `bun dev serve --port 4096 --hostname 0.0.0.0` — server must start and serve frontend
5. Tests: `bun test` in `packages/opencode` directory — 894+ pass expected
6. Check: no references to deleted animation files (`motion.ts`, `motion.css`, `motion-transitions.css`) in the restored packages (they shouldn't exist since we restored clean upstream)

## Out of Scope

- Desktop app native build (Tauri/Rust compilation) — only TS/Vite build needed
- Desktop-electron package — not restoring
- Storybook, console, containers — not restoring
- Enterprise/identity/slack/extensions/function/hub/Claude — already deleted, staying deleted
- Custom animation system preservation — replaced by upstream
- UI redesign — deferred
- Upstream sync automation — deferred

## Risks

1. **Workspace server-side dependencies**: `control-plane/` may import modules that changed between v1.2.5 and v1.2.24 (e.g., `@/util/filesystem`, `@/storage/db`). The orchestrator must check imports and copy any missing dependencies.
2. **SDK regeneration**: Upstream SDK at v1.2.24 has new types (`Workspace`, `Session2`, `Config2`). Our opencode server's OpenAPI spec needs to match. May need to regenerate SDK after workspace routes are added.
3. **Orchestra feature adaptation**: The 4 new files and ~7 surgical edits were written against v1.2.5 base files. The v1.2.24 files have different component structures, new props, and rearranged code. Each edit needs careful adaptation.
4. **Catalog alignment**: Desktop's Tauri plugin dependencies need corresponding catalog entries in root `package.json`.

## Acceptance Criteria

- [ ] `bun install` succeeds
- [ ] `bun turbo typecheck` passes all packages
- [ ] `bun run --cwd packages/app build` produces `packages/app/dist/` with working frontend
- [ ] `bun dev serve --port 4096 --hostname 0.0.0.0` starts server, serves frontend at localhost:4096
- [ ] Tests pass (894+ pass)
- [ ] Breadcrumbs render in subagent sessions
- [ ] Permission overlay badge visible from any session
- [ ] Context health indicators appear in breadcrumbs and task cards
- [ ] Subagent tab in right panel shows child sessions
- [ ] Desktop package exists and typechecks (native build not required)
- [ ] Workspace route responds to `GET /workspace` and `POST /workspace`
- [ ] No stale references to custom animation files (`packages/app/src/utils/motion.ts`, `packages/ui/src/styles/motion.css`, `packages/ui/src/styles/motion-transitions.css`)
