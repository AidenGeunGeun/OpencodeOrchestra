# AGENTS.md — packages/opencode

Guide for AI coding agents working inside the `packages/opencode` package.

For repo-wide conventions (style guide, naming, export patterns, error handling, release workflow, Orchestra-specific code, upstream divergences) see the root `AGENTS.md`.

## Build / Test Commands

| Task                  | Command                                               |
| --------------------- | ----------------------------------------------------- |
| **Run (dev)**         | `bun run --conditions=browser ./src/index.ts`         |
| **Typecheck**         | `bun run typecheck` (`tsgo --noEmit`)                 |
| **Test**              | `bun test`                                            |
| **Single test**       | `bun test ./test/tool/tool.test.ts` (note `./` prefix)|
| **Build**             | `bun run build --single --skip-install`               |
| **SDK regen**         | `bunx @hey-api/openapi-ts` (from `packages/sdk/js`)   |
| **Headless server**   | `bun dev serve --port 4096`                           |
| **Server + browser**  | `bun dev web --port 4096`                             |

Built Linux x64 binary: `dist/@skybluejacket/oco-linux-x64/bin/oco`

## Server Architecture

The HTTP server lives in `src/server/server.ts` and is a Bun/Hono application exported as `Server.App()`.

### Route Groups

| Mount path       | Handler module                          | Purpose                                        |
| ---------------- | --------------------------------------- | ---------------------------------------------- |
| `/global`        | `src/server/routes/global.ts`           | Global (cross-project) state                   |
| `/project`       | `src/server/routes/project.ts`          | Project info, worktrees                        |
| `/session`       | `src/server/routes/session.ts`          | Sessions (create, list, stream, revert, share) |
| `/pty`           | `src/server/routes/pty.ts`             | PTY (pseudo-terminal) management               |
| `/config`        | `src/server/routes/config.ts`           | Config read/write                              |
| `/provider`      | `src/server/routes/provider.ts`         | Provider listing and model info                |
| `/mcp`           | `src/server/routes/mcp.ts`              | Model Context Protocol servers                 |
| `/permission`    | `src/server/routes/permission.ts`       | Permission prompt/response                     |
| `/question`      | `src/server/routes/question.ts`         | User question prompt/response                  |
| `/experimental`  | `src/server/routes/experimental.ts`     | Experimental endpoints                         |
| `/tui`           | `src/server/routes/tui.ts`              | TUI-specific endpoints                         |
| `/` (file)       | `src/server/routes/file.ts`             | File read/list endpoints                       |
| `/auth/:id`      | inline                                  | Auth credentials set/remove                    |
| `/event`         | inline                                  | SSE event stream (`Bus.subscribeAll`)           |
| `/*` (catch-all) | inline                                  | Local frontend serving or upstream proxy       |

Additional top-level routes: `/doc` (OpenAPI spec), `/path`, `/vcs`, `/command`, `/log`, `/agent`, `/skill`, `/lsp`, `/formatter`, `/instance/dispose`.

### Request-Scoped Project Context

Every request that needs a project context goes through this middleware (after `/auth` and `/global`):

```ts
const directory = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
return Instance.provide({ directory, init: InstanceBootstrap, fn: () => next() })
```

`Instance.provide()` bootstraps (or reuses) a project instance for the given directory and makes it available to all handlers via `Instance.use()`. This is how one server process handles multiple projects simultaneously.

### Local Frontend Serving

The catch-all route `/*` in `src/server/server.ts` resolves the frontend in this order:

1. `OPENCODE_FRONTEND_DIR` env var (if set and contains `index.html`)
2. `../frontend` relative to the packaged server bundle — compiled binary frontend
3. `../../../app/dist` relative to the server source file — monorepo build output
4. `~/.local/share/oco/frontend` — XDG data directory install
5. Falls back to proxying `https://app.opencode.ai`

Non-file-extension paths fall through to `index.html` for SPA routing. All HTML responses include a strict `Content-Security-Policy` header.

To check which directory is active:

```sh
bun dev web --port 4096
# prints "Local frontend: serving from <path>" or "proxied from app.opencode.ai"
```

## CLI Structure

Entry point: `src/cli/index.ts` → yargs command tree in `src/cli/cmd/`.

Key commands:

| Command   | File                    | Description                                              |
| --------- | ----------------------- | -------------------------------------------------------- |
| `serve`   | `src/cli/cmd/serve.ts`  | Start headless HTTP server                               |
| `web`     | `src/cli/cmd/web.ts`    | Start server and open browser                            |
| `tui`     | `src/cli/cmd/tui/`      | Terminal UI (default command)                            |
| `auth`    | `src/cli/cmd/auth.ts`   | Manage provider credentials                              |
| `models`  | `src/cli/cmd/models.ts` | List available models                                    |
| `session` | `src/cli/cmd/session.ts`| Session management                                       |
| `run`     | `src/cli/cmd/run.ts`    | Non-interactive session run                              |
| `agent`   | `src/cli/cmd/agent.ts`  | Agent listing / info                                     |

## TUI

The terminal UI lives in `src/cli/cmd/tui/`. It is a SolidJS application rendered to the terminal using `@opentui/solid`. Key files:

- `app.tsx` — TUI root; agent cycle lock for subagent sessions
- `routes/session/index.tsx` — session view; model reset, sibling nav, `oco -s`
- `routes/session/sidebar.tsx` — sidebar; OpenCodeOrchestra branding
- `routes/session/header.tsx` — token and cache display
- `component/prompt/index.tsx` — prompt input; `effectiveAgent` memo
- `context/local.tsx` — local context; `model.clear()` method

The TUI communicates with the server using `@opencode-ai/sdk`. When running interactively, it starts the server in-process via `Server.App().fetch` rather than over HTTP.

## Key Patterns

### Namespace Exports

All modules use namespace exports:

```ts
export namespace Session {
  export const Info = z.object({ ... })
  export type Info = z.infer<typeof Info>
  export async function get(id: string) { ... }
}
```

### Dependency Injection via `Instance.provide()`

Project context is request-scoped. Never access `Instance.use()` outside of a handler wrapped by `Instance.provide()`.

### Event Bus

`src/bus/` — `Bus.publish(event)` / `Bus.subscribeAll(handler)`. Events are typed via `BusEvent`. The `/event` SSE endpoint streams all bus events to connected clients.

### Logging

```ts
const log = Log.create({ service: "my-module" })
log.info("message", { extra: "data" })
log.error("failed", { error })
```

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: relative paths for local modules; named imports preferred
- **Types**: Zod schemas for validation, TypeScript namespaces for structure
- **Formatting**: Prettier with `semi: false`, `printWidth: 120`, 2-space indent
- **Error handling**: `NamedError.create()` pattern; avoid throwing raw errors in tools
- **Storage**: SQLite via drizzle-orm (`Database.use()` / `Database.transaction()`); legacy JSON sidecar for `agentID`
- **AI SDK**: v6.x ecosystem (`ai@6.0.90`, `@ai-sdk/anthropic@3.0.45`); Claude 4.6 uses adaptive thinking

## SSE Heartbeat

The SSE event stream (`src/server/routes/global.ts`) sends heartbeats at a fixed interval. The Desktop client (`packages/app/src/context/global-sdk.tsx`) has a **15-second** timeout — if no events arrive within 15s, it aborts and reconnects.

**The server heartbeat MUST be less than 15 seconds** (currently 10s). If it's >= 15s, the Desktop enters a perpetual reconnect loop and misses events during disconnected windows. This manifests as messages from TUI not appearing in Desktop until the user navigates away and back.

## Plugin System

### Command Sentinel Pattern

Plugins can handle slash commands by throwing sentinel errors ending with `_HANDLED__` (e.g., `throw new Error("__COMPRESS_MANAGE_HANDLED__")`). In `session/prompt.ts`, `SessionPrompt.command()` catches these — if the error message matches the `_HANDLED__` suffix, it returns `undefined` instead of re-throwing. The server route in `server/routes/session.ts` returns HTTP 204 for null command results.

### Plugin Loader (`src/plugin/index.ts`)

Supports three specifier formats in the config `plugin` array:

1. **`file://` paths** — e.g., `file:///path/to/dist/index.js` (local dev)
2. **npm packages** — e.g., `opencode-context-compress@1.0.0` (uses `BunProc.install()`)
3. **GitHub repos** — e.g., `github:owner/repo#tag` (uses `BunProc.installGit()`)

GitHub deps: `bun add` does NOT run lifecycle scripts for git dependencies. The plugin's `dist/` directory must be committed to the repo. Package name resolution after `bun add github:...` uses exact match → prefix match → diff on cache package.json.

### Built-In Auth Plugins

- `src/plugin/codex.ts` handles the OpenAI / ChatGPT subscription-backed OAuth path.
- That Codex OAuth path allows the GPT-5.4 and GPT-5.5 subscription families and normalizes aliases to canonical upstream model IDs via `api.id`.
- Rewritten Codex OAuth Responses requests intentionally identify as Codex CLI traffic: `originator: codex_cli_rs`, a Codex-shaped `User-Agent` with sanitized terminal metadata, version/session/request/window headers, prompt-cache key, and installation metadata.
- GPT-5.x Fast/priority compute stays explicit and model-scoped: use a model alias with canonical `id`/`api.id` plus `options.serviceTier: "priority"`; do not add a global `/fast` toggle for the multi-provider app without a new product decision.
- GPT-5.5 stays capped at a 272K Codex client window until OpenAI raises the catalog `max_context_window`, even though the public announcement mentions 400K.
- `src/plugin/anthropic.ts` handles Anthropic OAuth directly in-tree.
- Anthropic token exchange / refresh requests use `application/x-www-form-urlencoded` plus the auth-side `User-Agent: claude-cli/2.1.80`; do not send the OpenCode CLI fingerprint on OAuth token calls because it is prone to `429` failures.
- The OAuth code exchange sends the original PKCE verifier back as `state`, not a parsed `code#...` suffix, so plain authorization-code pastes still validate correctly.
- Message requests and OAuth requests intentionally use different Anthropic-facing request shaping.
- If users were already in a broken Anthropic auth state before upgrading, have them re-run `oco auth login -p anthropic -m "Claude Pro/Max"`.

If Claude auth regresses, inspect `src/plugin/anthropic.ts` before reaching for an external plugin workaround.

## Bus → SSE Event Flow

```
Bus.publish(event, properties)
  → local subscribers (Bus.subscribe / Bus.subscribeAll)
  → GlobalBus.emit("event", { directory: Instance.directory, payload })
  → SSE handler in global.ts: GlobalBus.on("event", handler)
  → stream.writeSSE({ data: JSON.stringify(event) })
  → Desktop receives, queues, flushes, calls applyDirectoryEvent()
```

All `Bus.publish()` calls emit to ALL connected SSE clients, regardless of which client initiated the action. This is how cross-client sync works (TUI messages appear in Desktop and vice versa).

## Tests

Tests live in `test/`. Run with `bun test`. Always run `bun test` before committing changes to this package.
