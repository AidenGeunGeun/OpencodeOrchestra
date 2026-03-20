# AGENTS.md — OpenCode Orchestra

Guide for AI coding agents working in this repository.

## Communication Language

- **기본 언어: 한국어** — 사용자와의 모든 대화는 한국어로 진행한다.
- **기술 용어는 영어 유지** — `finishReason`, `providerOptions`, `streamText`, 파일 경로, 함수명, 타입명 등 코드/기술 용어는 영어 그대로 사용한다.
- 코드 주석과 commit message는 영어로 작성한다.
- Spec, backlog, 문서 파일 내용은 영어로 작성하되, 사용자와의 대화 중 설명은 한국어로 한다.

## Quick Reference

| Task                      | Command                                          | Where to run        |
| ------------------------- | ------------------------------------------------ | ------------------- |
| **Build**                 | `bun run build`                                  | `packages/opencode` |
| **Build (single)**        | `bun run build --single --skip-install`          | `packages/opencode` |
| **Typecheck**             | `tsgo --noEmit`                                  | `packages/opencode` |
| **Test all**              | `bun test`                                       | `packages/opencode` |
| **Test single file**      | `bun test path/to/file.test.ts`                  | `packages/opencode` |
| **SDK regen**             | `bunx @hey-api/openapi-ts`                       | `packages/sdk/js`   |
| **Build web frontend**    | `bun run --cwd packages/app build`               | repo root           |
| **Frontend dev server**   | `bun run --cwd packages/app dev`                 | repo root           |
| **Headless server**       | `bun dev serve --port 4096`                      | `packages/opencode` |
| **Server + browser**      | `bun dev web --port 4096`                        | `packages/opencode` |

- Built Linux x64 binary path: `packages/opencode/dist/@skybluejacket/oco-linux-x64/bin/oco`

- Package manager: **Bun** (see root `package.json` for the pinned version)
- Build orchestrator: **Turbo** (`turbo.json`)
- Default branch: **`main`**
- Storage: **SQLite** (drizzle-orm) at `~/.local/share/opencode/opencode.db`

## Search Safety

- Never run broad repo searches against `.` parent directories, or large home-level paths such as `/home/skybl`.
- Always scope `rg`, `grep`, `glob`, and `code-intel` to the exact repository or subdirectory you need.
- Prefer the narrowest viable path first; widen only when the smaller scope is proven insufficient.
- This avoids runaway CPU usage, long hangs, and noisy results from unrelated repositories.

## Release Workflow

- GitHub repo: `AidenGeunGeun/OpenCodeOrchestra`
- Tag pattern: `oco-v<version>` (example: `oco-v1.0.12`)
- Version source of truth: `packages/opencode/package.json` (release script bumps all 8 packages)
- Local `oco` launcher: `packages/opencode/bin/oco` → resolves `packages/opencode/dist/@skybluejacket/oco-*/bin/oco`

### Release Steps

1. Run `bun run release [patch|minor|major|X.Y.Z]` from repo root.
   - Bumps all `package.json` files, runs `bun install`, typecheck, builds CLI binary + frontend, deploys frontend to XDG, commits, tags.
2. Push commits and **only the new tag**:
   ```sh
   git push && git push origin oco-v<version>
   ```
   **IMPORTANT**: Never use `git push --tags`. The repo has hundreds of inherited upstream tags that will fail to push and flood the output. Always push the specific tag by name.
3. GitHub Actions triggers:
   - `test` workflow runs typecheck + tests on the push to `main`.
   - `desktop-build` workflow builds macOS + Linux desktop apps and attaches them to a GitHub Release.
4. Desktop app artifacts appear on `https://github.com/AidenGeunGeun/OpenCodeOrchestra/releases/tag/oco-v<version>` within ~10–15 minutes.

### Prompt Bundling (optional)

For prompt-bundling releases, treat `~/.config/opencode/opencode.jsonc` as the source of truth for which user prompt overrides are currently in use, then sync those from `~/.config/opencode/prompts/` into `packages/opencode/src/agent/prompt/`.
- Current in-use bundled sync set: `pm.txt`, `orchestrator.txt`, `researcher.txt`, `investigator.txt`, `auditor.txt`, `compaction.txt`, `docs.txt`
- Do not update bundled prompts without active user overrides: `cleanup.txt`, `explore.txt`, `summary.txt`, `title.txt`, `pm-plan.txt`
- Verify synced prompts with `diff -u ~/.config/opencode/prompts/<name>.txt packages/opencode/src/agent/prompt/<name>.txt` before building.

## CI / CD

### Workflows (`.github/workflows/`)

| Workflow | File | Trigger | What it does |
|----------|------|---------|-------------|
| `test` | `test.yml` | Push to `main`, manual | `bun turbo typecheck` + `bun turbo test` on `ubuntu-latest` |
| `desktop-build` | `desktop-build.yml` | Tag push `oco-v*`, manual | Builds Tauri desktop app on macOS + Linux, uploads to GitHub Release |

### Setup Action

`.github/actions/setup-bun/action.yml` — composite action that installs Bun (version from `package.json`), caches `~/.bun`, and runs `bun install`.

### Desktop Build Matrix

| Name | Runner | Rust Target | Output |
|------|--------|-------------|--------|
| macOS (Apple Silicon) | `macos-latest` | `aarch64-apple-darwin` | `.dmg`, `.app.tar.gz` |
| Linux (x86_64) | `ubuntu-latest` | `x86_64-unknown-linux-gnu` | `.deb`, `.rpm`, `.AppImage` |

The build steps: checkout → setup Bun → setup Rust → install Linux deps (if Linux) → build sidecar binary → copy sidecar to Tauri sidecars dir → `bunx tauri build --config src-tauri/tauri.prod.conf.json` → upload to GitHub Release.

Release artifact upload only runs on tag pushes (not manual `workflow_dispatch` runs).

## Desktop App

### Architecture

`packages/desktop/` is a **Tauri v2** app (Rust backend + SolidJS frontend). It wraps the same `packages/app` SPA in a native window and bundles the `oco` CLI binary as a sidecar.

- **Entry**: `packages/desktop/src/index.tsx` — creates `Platform` with Tauri APIs (clipboard, file dialogs, notifications, deep links, updater)
- **Sidecar**: The `oco` CLI binary bundled at `src-tauri/sidecars/opencode-cli-<rust-target>`, launched at startup to provide the API server
- **Dev config**: `src-tauri/tauri.conf.json` (product name "OpenCode Dev")
- **Prod config**: `src-tauri/tauri.prod.conf.json` (product name "OpenCode Orchestra", identifier `ai.opencode.orchestra`)

### Server Connection Model

The desktop app supports three connection types via `AppInterface`:

- `ServerConnection.Sidecar` — bundled local server (default)
- `ServerConnection.Http` — remote HTTP server with optional Basic auth
- `ServerConnection.Ssh` — SSH tunnel to remote server

Server management UI: settings → Server → add/edit HTTP connections, health check, set default.

### Skip-Local-Server Feature

When a remote (non-loopback) HTTP server is set as default, the desktop app automatically sets `skipLocalServer: true`. On next launch, the sidecar server is NOT spawned — the app connects directly to the remote server, saving RAM on lightweight devices.

- Loopback addresses (`localhost`, `127.0.0.1`, `[::1]`) are NOT treated as remote.
- Setting sidecar/WSL/loopback as default or removing default resets `skipLocalServer` to `false`.
- Rust implementation: `packages/desktop/src-tauri/src/server.rs` (get/set commands), `lib.rs` (pre-spawn check)
- TypeScript: `packages/desktop/src/bindings.ts`, `packages/desktop/src/index.tsx`, `packages/app/src/context/platform.tsx`

### Sidecar Binary Naming

`packages/desktop/scripts/utils.ts` maps Rust target triples to build output names:

| Rust Target | Build Output (`ocBinary`) |
|-------------|--------------------------|
| `aarch64-apple-darwin` | `@skybluejacket/oco-darwin-arm64` |
| `x86_64-apple-darwin` | `@skybluejacket/oco-darwin-x64-baseline` |
| `x86_64-unknown-linux-gnu` | `@skybluejacket/oco-linux-x64-baseline` |
| `aarch64-unknown-linux-gnu` | `@skybluejacket/oco-linux-arm64` |

### User Setup (MacBook via Tailscale)

The intended workflow: `oco serve` runs on the gaming laptop (Arch Linux), MacBook connects via Tailscale using the desktop app.

1. Download the `.dmg` from GitHub Releases (under the `oco-vX.Y.Z` tag).
2. Open the `.dmg` and drag `OpenCodeOrchestra.app` to `/Applications`.
3. Before the first launch, run this command in Terminal:
   ```sh
   xattr -cr /Applications/OpenCodeOrchestra.app
   ```
   This is required because the app is unsigned — macOS Gatekeeper will block it otherwise. The command strips the quarantine attribute and clears any extended attributes that trigger the block.
4. Launch the app — it will show "Local Server" in the server selector initially.
5. Click the server selector → Add Server → enter `http://omarchy:4096` (Tailscale MagicDNS hostname) or the explicit Tailscale IP `http://100.86.127.34:4096`.
6. Leave the username and password fields empty (no authentication is needed over Tailscale).
7. Set the new server as default — the app automatically enables `skipLocalServer` for any non-loopback HTTP server, so the MacBook will not waste RAM spawning a local sidecar on the next launch.
8. On the gaming laptop, ensure the server is running:
   ```sh
   oco serve --port 4096 --hostname 0.0.0.0
   ```

## Project Structure

Monorepo with `packages/*` workspaces. Eight active packages:

| Package              | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `packages/opencode`  | Core CLI, Bun/Hono API server, TUI, agents, tools, providers, storage |
| `packages/app`       | SolidJS SPA web frontend served by the opencode server               |
| `packages/ui`        | Shared UI component library and theme system used by packages/app    |
| `packages/sdk`       | Generated JS/TS client SDK (`@opencode-ai/sdk`)                      |
| `packages/plugin`    | Plugin system (copilot, codex, client-wrapper)                       |
| `packages/desktop`   | Tauri v2 native desktop app wrapping the SolidJS frontend            |
| `packages/script`    | Build and utility scripts                                            |
| `packages/util`      | Shared runtime utilities (encode, error, path, binary, retry, …)     |

The core is `packages/opencode/src/`:

```
packages/opencode/src/
  agent/          # Agent definitions, prompts (.txt files)
  session/        # Session management, depth hierarchy, compaction, revert
  storage/        # SQLite (db.ts, schema), JSON migration, legacy JSON storage
  provider/       # LLM provider abstraction (16+ providers)
  tool/           # 60+ tools (bash, read, write, edit, glob, grep, task, finish-task...)
  permission/     # Permission system
  config/         # Configuration management
  cli/            # CLI bootstrap, commands, TUI (Solid.js + @opentui)
  plugin/         # Plugin system (copilot, codex, client-wrapper)
  mcp/            # Model Context Protocol integration
  lsp/            # Language Server Protocol
  project/        # Project/instance/VCS management
  control/        # Control account/token management
  skill/          # Skill loading system (file + URL discovery)
  control-plane/  # Workspace feature (workspace.ts, adaptors, routes, middleware)
  share/          # Session sharing (legacy + DB-backed)
  snapshot/       # File diff/snapshot management
  worktree/       # Git worktree management
  util/           # Shared utilities (log, context, defer, lock, queue, git...)
  bus/            # Event bus system

packages/opencode/migration/  # Drizzle SQL migration files (bundled at build time)
packages/opencode/test/       # Test files (run via `bun turbo test`)
packages/sdk/js/              # JS/TS SDK (generated from openapi.yml)
packages/app/                 # SolidJS SPA web frontend
packages/ui/                  # Shared UI components and theme system
```

Agent hierarchy: PM (depth 0) -> Orchestrator (depth 1) -> Subagents (depth 2+, singleShot).

## Web Frontend

### Architecture

The web UI is a three-layer stack:

- **`packages/app`** — SolidJS SPA. Contains all pages, contexts, and application logic. Built with Vite + `@tailwindcss/vite`. Entry point is `src/entry.tsx`.
- **`packages/ui`** — Shared component library and design system. Provides Tailwind configuration, CSS custom properties (theme tokens), and all reusable components (`Button`, `Dialog`, `Tooltip`, `Code`, `Diff`, etc.).
- **`packages/opencode`** — Bun/Hono server. Serves the built frontend and exposes the REST + SSE API consumed by the frontend via `@opencode-ai/sdk/v2`.

### Local Frontend Serving

`Server.resolveFrontendDir()` (`src/server/server.ts`) resolves the frontend directory in this order:

1. `OPENCODE_FRONTEND_DIR` environment variable (if set and contains `index.html`)
2. `../frontend` relative to binary — works in compiled `oco` binary (build copies frontend to `dist/<name>/frontend/`)
3. `../../../app/dist` relative to server source — monorepo build output (works with `bun dev serve`)
4. `~/.local/share/opencode/frontend` — XDG data dir install (set by `bun run release`)
5. Falls back to proxying `https://app.opencode.ai` for every unmatched request

**During development, use `bun dev serve`** (not `oco serve`). The compiled `oco` binary resolves `import.meta.dirname` to its install directory, so the monorepo-relative path (step 3) fails. `bun dev serve` runs from source where monorepo paths resolve correctly.

The catch-all `/*.` route serves static assets from the resolved directory with a strict Content-Security-Policy header. Non-file paths fall through to `index.html` (SPA routing).

### SDK Connection

The frontend imports `@opencode-ai/sdk/v2` (`createOpencodeClient`). In production (local serve), it connects to the same origin (`window.location.origin`). During development (`vite dev`), it defaults to `http://localhost:4096`. Multi-project support is implemented via the `x-opencode-directory` request header, which binds each API call to a specific project directory on the server.

### Build

```sh
bun run --cwd packages/app build   # produces packages/app/dist/
```

The server picks up `packages/app/dist/` automatically when run from the monorepo (path 2 above).

### Frontend Motion

- Use shared motion tokens from `packages/ui/src/styles/motion.css` as the duration/easing source of truth.
- Use reusable motion utilities from `packages/ui/src/styles/motion-transitions.css` for standard enter/exit patterns before adding per-component transition strings.
- Prefer visible motion built from `transform` + `opacity`.
- Avoid animating layout properties (`width`, `height`, `top`, `left`, etc.) unless the interaction truly depends on runtime-measured layout animation.
- Respect `prefers-reduced-motion`; token-driven motion should collapse automatically, and JS-coordinated presence timing must follow that behavior.
- When JS timers are required for overlap, deferred mount, or unmount timing, keep them aligned with the CSS motion token durations that own the visible transition.

## Orchestra Frontend Features

These are fork-only additions to the upstream WebUI, built for multi-agent orchestration visibility:

| Feature | Files | Description |
|---------|-------|-------------|
| **Breadcrumbs** | `packages/app/src/pages/session/session-breadcrumb.tsx`, `session.tsx` | Shows `PM › Orchestrator › Investigator` ancestry path. Clickable to navigate up. Uses direct SDK fetch to hydrate parent sessions. |
| **Permission Overlay** | `packages/app/src/components/permission-overlay.tsx`, `layout.tsx` | Floating badge + drawer showing ALL pending permissions across the session tree. Approve/deny from any depth. |
| **Context Health** | `packages/ui/src/components/context-health.tsx` | Per-session token usage vs model max. Color-coded (green/yellow/red). Shown in breadcrumbs, task cards, subagent list. |
| **Subagent Sidebar** | `packages/app/src/components/subagent-list.tsx`, `session-side-panel.tsx` | Right panel tab listing child sessions with title, agent type badge, status, context health. SSE real-time updates. |
| **Clickable Task Cards** | `packages/ui/src/components/message-part.tsx`, `basic-tool.tsx` | Task tool calls render as cards with context health + click-to-navigate into the subagent session. |

These files are additive (new files or surgical edits) and should be re-applied after any upstream frontend sync.

## Orchestra-Specific Code (DO NOT OVERWRITE on upstream sync)

These files contain fork-only logic. During upstream syncs, merge carefully:

- `agent/agent.ts` — Orchestra agent definitions, `singleShot` field
- `agent/prompt/*.txt` — All custom agent prompts
- `session/depth.ts` — Depth calculation, pruning logic
- `tool/finish-task.ts`, `tool/task.ts` — Orchestration tools
- `tool/registry.ts` — FinishTaskTool registration, todoread
- `plugin/client-wrapper.ts` — Depth-aware parentID masking
- `session/index.ts` — `agentID` sidecar, `Session.update()`, `getShare()`
- `session/processor.ts` — `updatePart({ part, delta })` pattern
- `cli/cmd/tui/component/prompt/index.tsx` — `effectiveAgent` memo
- `cli/cmd/tui/app.tsx` — Agent cycle lock for subagent sessions
- `cli/cmd/tui/routes/session/index.tsx` — Model reset, sibling nav, `oco -s`
- `cli/cmd/tui/routes/session/sidebar.tsx` — OpenCodeOrchestra branding
- `cli/cmd/tui/context/local.tsx` — `model.clear()` method
- `storage/json-migration.ts` — agentID sidecar backfill

## Upstream Divergences (preserve on sync)

Changes to non-Orchestra files that differ from upstream opencode 1.2.5 (`ai` 5.0.124 → 6.0.90).
Must be re-applied after any upstream merge. See `UPSTREAM-DIFF.md` for file-by-file details.

### Summary Table

| Category | Files affected | Key change |
|----------|---------------|------------|
| AI SDK 6.x migration | `package.json`, `session/index.ts`, `session/processor.ts`, `session/prompt.ts`, `provider/transform.ts`, `provider/provider.ts`, +26 more | `ai` 5→6, token semantics, finish reason normalization |
| Bug fixes | `cli/cmd/tui/thread.ts`, `cli/cmd/tui/routes/session/header.tsx`, `cli/cmd/tui/routes/session/sidebar.tsx`, `session/processor.ts` | SIGHUP zombie, reasoning display, text-delta guard |
| Features | `provider/provider.ts`, `cli/cmd/tui/routes/session/header.tsx`, `cli/cmd/tui/routes/session/sidebar.tsx`, `skill/discovery.ts` | 1M context, cache display, skill path validation |
| Config (external) | `opencode.jsonc`, `prompts/compaction.txt` | Flat thinking options, expanded compaction prompt |

### AI SDK 6.x — Package Versions

Upgraded in `packages/opencode/package.json`:

| Package | Upstream 1.2.5 | OCO |
|---------|---------------|-----|
| `ai` | 5.0.124 | 6.0.90 |
| `@ai-sdk/anthropic` | 2.0.62 | 3.0.45 |
| `@ai-sdk/amazon-bedrock` | 3.0.79 | 4.0.61 |
| `@ai-sdk/openai` | 2.0.89 | 3.0.29 |
| `@ai-sdk/google` | 2.0.52 | 3.0.29 |
| `@ai-sdk/google-vertex` | 3.0.103 | 4.0.59 |
| `@ai-sdk/gateway` | 2.0.30 | 3.0.49 |
| `@ai-sdk/azure` | 2.0.91 | 3.0.30 |

Also added `provider/sdk/openai-compatible/src/` (new OpenAI-compatible provider SDK directory).

### AI SDK 6.x — Token Semantics (`session/index.ts`)

`getUsage()` (lines 685–727): removed `excludesCachedTokens` provider-conditional flag.

**Why:** AI SDK 6.x `usage.inputTokens` always includes all cached tokens for all providers.
Upstream 1.2.5 used `excludesCachedTokens = !!(metadata.anthropic || metadata.bedrock)` to
conditionally subtract cache — no longer needed in 6.x.

**Now:**
- `normalizeTokenCount()` (line 692): local helper handling `{ total: number }` objects from AI SDK 6.x.
- `cacheReadInputTokens = normalizeTokenCount(usage.cachedInputTokens)` (line 701)
- `cacheWriteInputTokens` from `providerMetadata.anthropic.cacheCreationInputTokens` (line 702)
- `adjustedInputTokens = inputTokens - cacheRead - cacheWrite` (lines 712–713)
- DB stores `tokens.input` as this adjusted (uncached) value.

### AI SDK 6.x — Finish Reason Normalization

In AI SDK 6.x, `finishReason` may be `{ unified: string }` instead of a plain string.

**`session/processor.ts` (line 23):** local `normalizeFinishReason(fr: unknown): string` — unwraps
`{ unified }` objects, falls back to `"unknown"`.

**`session/prompt.ts` (line 63):** identical local `normalizeFinishReason` — guards loop-continuation
check at line 332 (`!["tool-calls","unknown"].includes(normalizeFinishReason(lastAssistant.finish))`).

Upstream 1.2.5 compared `finishReason` directly as a string; this breaks under AI SDK 6.x.

### AI SDK 6.x — Claude 4.6 Adaptive Thinking (`provider/transform.ts`)

Two new private helpers (lines 339–353):
- `isClaude46(id)` — returns `true` if model ID contains `"4-6"` or `"4.6"`.
- `claude46Variants(id)` — returns variant map with `{ thinking: { type: "adaptive" }, effort }`.
  Opus models additionally get an `"max"` effort tier.

These replace inline per-model checks that existed in upstream (which used `budgetTokens` instead
of `type: "adaptive"`). Applied in `variants()` for `@ai-sdk/anthropic`, `@ai-sdk/google-vertex/anthropic`,
`@ai-sdk/amazon-bedrock`, and SAP AI providers.

Also: `ProviderTransform.providerOptions()` (line 818) added for gateway-aware provider option routing.

### AI SDK 6.x — Misc (`session/index.ts`, `session/processor.ts`)

- `Session.updatePart()` (line 659): signature changed to union type — accepts either a bare
  `MessageV2.Part` or `{ part: MessageV2.Part; delta: string }` for text streaming.
  Upstream used a separate `updatePartDelta()` function; OCO consolidates into one.
- `Session.update()` (line 370): new generic update function with draft-editor pattern and
  `agentID` sidecar awareness. Replaces `setTitle()` / `setPermission()` for most callers.
- `session/prompt.ts`: `LoopInput` changed to `z.union([Identifier, { sessionID, resume_existing }])`
  for more flexible invocation; `Session.setPermission` calls replaced with `Session.update()` draft pattern.

### Package-Specific Auth Notes

Recent OAuth/plugin behavior lives in `packages/opencode/AGENTS.md`, not here.

- OpenAI/Codex OAuth alias handling and GPT-5.4 family allowlists are package-specific.
- Anthropic OAuth compatibility and request shaping are package-specific.
- If Claude or ChatGPT subscription auth regresses, start in `packages/opencode/src/plugin/` and read `packages/opencode/AGENTS.md` first.

### Feature — Cache Token Display (`cli/cmd/tui/routes/session/header.tsx`, `sidebar.tsx`)

**`header.tsx` (lines 52–62):** token total computed as `input + output + cache.read + cache.write`
(no reasoning). Displays `"71,025 (Cached 69,211)"` when cache tokens are present.

**`sidebar.tsx` (lines 55–100):** context section shows a separate `"69,211 cached"` line
(`show when context().cached`).

Upstream included `+ last.tokens.reasoning` in the total — incorrect under AI SDK 6.x where
reasoning is auto-stripped by providers before returning usage.

### Feature — Skill Path Validation (`skill/discovery.ts`)

Added defensive validation for URL-based skill loading:
- `normalizeSkillName(name)`: rejects names with chars outside `[a-zA-Z0-9._-]` and `"."` / `".."`.
- `normalizeSkillFile(file)`: rejects null bytes, absolute paths, protocol URIs; normalizes separators.
- `isWithin(root, candidate)`: path traversal guard — rejects paths escaping the cache root.
- URL boundary check: verifies resolved skill file URL stays within `skillBase.origin + pathname`.
- Zod schema (`Index`) replaces plain type for index parsing, adding `.min(1)` constraints.

Upstream had no validation; a malicious `index.json` could write files outside the skill cache.

### Bug Fix — Zombie Process on Terminal Close (`cli/cmd/tui/thread.ts`)

Lines 131–136: `SIGHUP` handler added:
```ts
process.on("SIGHUP", async () => {
  await client?.call("shutdown", undefined).catch(() => {})
  process.exit(0)
})
```
Lines 191–193: `finally` block calls `client?.call("shutdown")` as safety net.
`client` declaration hoisted outside `try` to be accessible in `finally`.

Upstream has no `SIGHUP` handling; closing the terminal window while `--port` is active
leaves an orphan worker process holding the TCP port.

### External Config (not in `src/`)

| File | Change |
|------|--------|
| `opencode.jsonc` | Flat thinking options (`thinking`, `effort`, `reasoningEffort` directly on agents instead of `variant` system). Adaptive thinking for Claude 4.6. 1M context model definitions (`claude-sonnet-4-6-1m`, `claude-opus-4-6-1m`). |
| `~/.config/opencode/prompts/compaction.txt` | Expanded ~71 → ~100 lines; adds self-review pass and proactive enrichment rules. |

## Conventions & Lessons Learned

### Always Update AGENTS.md

When you discover non-obvious behavior, fix a subtle bug, or establish a convention during work in this repo, write it down in the most relevant AGENTS.md file. The root AGENTS.md covers cross-cutting concerns; nested AGENTS.md files cover package-specific knowledge. Future sessions should not have to re-discover what was already learned.

### Version Sync

**All packages MUST share the same version number.** When bumping the version, update ALL of these:

| File | Field |
|------|-------|
| `packages/opencode/package.json` | `version` |
| `packages/desktop/package.json` | `version` |
| `packages/app/package.json` | `version` |
| `packages/sdk/js/package.json` | `version` |
| `packages/ui/package.json` | `version` |
| `packages/plugin/package.json` | `version` |
| `packages/util/package.json` | `version` |
| `sdks/vscode/package.json` | `version` |
| `packages/desktop/src-tauri/Cargo.toml` | `version` |

The `bun run release` script handles this automatically. If bumping manually, check every file. Tauri reads its version from `packages/desktop/package.json` (via `"version": "../package.json"` in `tauri.conf.json`).

### SSE Event System (Server ↔ Desktop)

The server emits real-time events to all connected clients via Server-Sent Events (SSE):

```
Bus.publish() → GlobalBus.emit("event", {...}) → SSE stream → Desktop event-reducer → reactive store → UI
```

**Critical timing constraint**: The Desktop client (`packages/app/src/context/global-sdk.tsx`) has a heartbeat timeout of **15 seconds** (`HEARTBEAT_TIMEOUT_MS`). If no events arrive within 15s, the Desktop aborts and reconnects. The server heartbeat interval (`packages/opencode/src/server/routes/global.ts`) **MUST be less than 15 seconds** (currently 10s). If it exceeds 15s, the Desktop enters a perpetual connect/disconnect loop and misses events during disconnected windows.

**Symptom of broken SSE**: Messages sent from TUI don't appear in Desktop (and vice versa) until the user navigates away and back. Server logs show rapid `global event connected` / `global event disconnected` cycling at ~15s intervals.

### Plugin Command Sentinel Pattern

Plugins can "handle" slash commands by throwing sentinel errors (e.g., `throw new Error("__COMPRESS_MANAGE_HANDLED__")`). The server catches these in `SessionPrompt.command()` — if the error message ends with `_HANDLED__`, it returns `undefined` instead of re-throwing. The server route returns HTTP 204 (no content) for null command results.

**Desktop must sync after commands**: After a command returns (even 204), call `sync.session.sync(sessionId, { force: true })`. Without `force: true`, the sync short-circuits because messages are already cached for the current session. The plugin may have created messages server-side that the Desktop cache doesn't know about.

### Desktop Agent Selector & session.agentID

Each session can have an `agentID` field (set when subagent sessions are created via the Task tool). The TUI reads `session.agentID` and locks the agent selector for child sessions. The Desktop must do the same:

- Show `session.agentID` in the selector when viewing a child session
- Disable the selector (prevent cycling)
- Use `session.agentID` for submission instead of `local.agent.current().name`
- Skip `local.agent.set()` in `syncSessionModel` when the session has a locked agent

If the Desktop ignores `session.agentID`, it falls back to the first primary agent (usually "build"), causing subagents to receive wrong agent identity and prompts.

### Plugin Loader

`packages/opencode/src/plugin/index.ts` supports three plugin specifier formats:

1. **`file://` paths** — local development, e.g., `file:///path/to/dist/index.js`
2. **npm packages** — e.g., `opencode-context-compress` or `opencode-context-compress@1.0.0`
3. **GitHub repos** — e.g., `github:AidenGeunGeun/opencode-context-compress` or `github:owner/repo#tag`

GitHub deps are installed via `bun add github:...` into `Global.Path.cache`. The package's `dist/` directory must be committed to the repo (bun doesn't run lifecycle scripts for git deps). Package name resolution after install uses a three-strategy approach (exact match → prefix match → diff on package.json).

## Formatting

- **Prettier** with `semi: false` and `printWidth: 120`
- 2-space indentation
- No semicolons

## Style Guide

### Prefer `const` over `let`

Use ternaries or early returns instead of mutable reassignment.

### Avoid `else` statements

Prefer early returns or IIFEs.

### Keep things in one function

Unless composable or reusable, don't split into multiple functions.

### Avoid unnecessary destructuring

Preserve context by using dot access: `obj.a` not `const { a } = obj`.

### Use Bun APIs

Prefer `Bun.file()`, `Bun.write()`, `Bun.build()` over Node equivalents.

## Naming Conventions

| Category          | Convention    | Examples                                    |
| ----------------- | ------------- | ------------------------------------------- |
| Files/directories | `kebab-case`  | `agent.ts`, `bus-event.ts`, `tool/`         |
| Variables/funcs   | `camelCase`   | `calculateDepth`, `defaultModel`            |
| Types/interfaces  | `PascalCase`  | `Info`, `Context`, `Logger`                 |
| Error classes     | `PascalCase`  | `RejectedError`, `BusyError`, `NotFound`    |
| Constants         | `UPPER_CASE`  | `MAX_DEPTH`                                 |

**Prefer single-word names.** Only use multi-word if truly necessary.

## Export Pattern: Namespaces

The codebase uses **namespace exports** with nested types and functions:

```ts
export namespace Agent {
  export const Info = z.object({ ... })
  export type Info = z.infer<typeof Info>
  export async function get(agent: string) { ... }
}
```

Follow this pattern for new modules.

## Error Handling

- Custom error classes via `NamedError.create()` pattern
- `NotFoundError` from `storage/db.ts`
- Permission errors: `RejectedError`, `CorrectedError`, `DeniedError`
- Session errors: `BusyError`
- Logging: `Log.create({ service: "name" })` with levels DEBUG/INFO/WARN/ERROR

## Database

- SQLite via drizzle-orm (`src/storage/db.ts`)
- `Database.use(db => ...)` for queries, `Database.transaction(db => ...)` for writes
- Schema in `*.sql.ts` files alongside domain modules
- Migrations in `migration/` directory, bundled as `OPENCODE_MIGRATIONS` at build time
- Legacy JSON storage (`src/storage/storage.ts`) still used for sidecar data

## AI SDK 6.x Token Semantics (Verified 2026-02-18)

Anthropic raw API returns three separate fields:
- `input_tokens` — uncached input only
- `cache_creation_input_tokens` — newly cached (cache write)
- `cache_read_input_tokens` — cache hit (cache read)

AI SDK 6.x maps these as:
- `usage.inputTokens` = **total** (`input_tokens + cache_creation + cache_read`)
- `usage.cachedInputTokens` = `cache_read_input_tokens` only
- `providerMetadata.anthropic.cacheCreationInputTokens` = cache write only

Verified with raw log: `inputTokens(56298) = raw_input(3) + cache_write(166) + cache_read(56129)`.

**In `getUsage()` (`session/index.ts` lines 712–713`):**
```ts
const adjustedInputTokens =
  normalizeTokenCount(input.usage.inputTokens) - cacheReadInputTokens - cacheWriteInputTokens
```
→ equals Anthropic's raw `input_tokens` (uncached only).
DB stores `tokens.input` as this adjusted value. TUI reconstructs display total as `input + cache.read + cache.write + output`.

**Upstream 1.2.5 (AI SDK 5.x):** Anthropic `inputTokens` EXCLUDED cache tokens. A provider-conditional
flag `excludesCachedTokens = !!(metadata.anthropic || metadata.bedrock)` controlled whether cache was
subtracted. This flag is gone in OCO — AI SDK 6.x includes cache in `inputTokens` for **all** providers.
