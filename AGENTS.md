# AGENTS.md — OpenCode Orchestra

Guide for AI coding agents working in this repository.

## Quick Reference

| Task                 | Command                                          | Where to run       |
| -------------------- | ------------------------------------------------ | ------------------- |
| **Build**            | `bun run build`                                  | `packages/opencode` |
| **Build (single)**   | `bun run build --single --skip-install`          | `packages/opencode` |
| **Typecheck**        | `tsgo --noEmit`                                  | `packages/opencode` |
| **Test all**         | `bun test`                                       | `packages/opencode` |
| **Test single file** | `bun test path/to/file.test.ts`                  | `packages/opencode` |
| **SDK regen**        | `bunx @hey-api/openapi-ts`                       | `packages/sdk/js`   |

- Package manager: **bun@1.3.9**
- Build orchestrator: **Turbo** (`turbo.json`)
- Default branch: **`main`**
- Storage: **SQLite** (drizzle-orm) at `~/.local/share/opencode/opencode.db`

## Project Structure

Monorepo with `packages/*` workspaces. The core is `packages/opencode/`:

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
  share/          # Session sharing (legacy + DB-backed)
  snapshot/       # File diff/snapshot management
  worktree/       # Git worktree management
  util/           # Shared utilities (log, context, defer, lock, queue, git...)
  bus/            # Event bus system

packages/opencode/migration/  # Drizzle SQL migration files (bundled at build time)
packages/opencode/test/       # Test files (878 pass / 29 skip / 0 fail)
packages/sdk/                 # SDK (generated from openapi.yml)
packages/app/                 # Desktop app (Solid.js)
packages/web/                 # Documentation site (Astro)
```

Agent hierarchy: PM (depth 0) -> Orchestrator (depth 1) -> Subagents (depth 2+, singleShot).

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
