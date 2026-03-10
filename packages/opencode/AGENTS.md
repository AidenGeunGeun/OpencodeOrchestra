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
2. `../../app/dist` relative to the server source file — monorepo build output
3. `~/.local/share/opencode/frontend` — XDG data directory install
4. Falls back to proxying `https://app.opencode.ai`

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

## Tests

Tests live in `test/`. Run with `bun test`. Current baseline: 884 pass / 29 skip / 0 fail. Always run `bun test` before committing changes to this package.
