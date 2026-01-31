# AGENTS.md — OpenCode Orchestra

Guide for AI coding agents working in this repository.

## Quick Reference

| Task                 | Command                                          | Where to run       |
| -------------------- | ------------------------------------------------ | ------------------- |
| **Build**            | `bun run script/build.ts`                        | `packages/opencode` |
| **Build (single)**   | `bun run script/build.ts --single`               | `packages/opencode` |
| **Typecheck**        | `bun typecheck`                                  | repo root           |
| **Typecheck (pkg)**  | `tsgo --noEmit`                                  | `packages/opencode` |
| **Test all**         | `bun test`                                       | `packages/opencode` |
| **Test single file** | `bun test path/to/file.test.ts`                  | `packages/opencode` |
| **Format**           | `bun run --prettier --write src/**/*.ts`         | `packages/opencode` |
| **Publish**          | `bun run script/publish.ts`                      | `packages/opencode` |
| **SDK regen**        | `./packages/sdk/js/script/build.ts`              | repo root           |

- Package manager: **bun@1.3.5**
- Build orchestrator: **Turbo** (`turbo.json`)
- Default branch: **`dev`**
- CI runs on push to `dev`, all PRs, and manual dispatch

## Project Structure

Monorepo with `packages/*` workspaces. The core is `packages/opencode/`:

```
packages/opencode/src/
  agent/          # Agent definitions, prompts (.txt files)
  session/        # Session management, depth hierarchy, compaction
  provider/       # LLM provider abstraction (16+ providers)
  tool/           # 60+ tools (bash, read, write, edit, glob, grep, task...)
  permission/     # Permission system with custom error classes
  config/         # Configuration management
  cli/            # CLI bootstrap and commands
  plugin/         # Plugin system (copilot, codex)
  mcp/            # Model Context Protocol integration
  lsp/            # Language Server Protocol
  project/        # Project/instance/VCS management
  util/           # Shared utilities (log, context, defer, lock, queue...)
  bus/            # Event bus system
  skill/          # Skill loading system
```

Agent hierarchy: PM (depth 0) -> Orchestrator (depth 1) -> Subagents (depth 2+, singleShot).

## Formatting

- **Prettier** with `semi: false` and `printWidth: 120`
- 2-space indentation
- No semicolons
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE

## Style Guide

### Prefer `const` over `let`

Especially combined with if/else. Use ternaries or early returns instead.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Avoid `else` statements

Prefer early returns or IIFEs.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Keep things in one function

Unless composable or reusable, don't split into multiple functions.

### Avoid unnecessary destructuring

Preserve context by using dot access.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Avoid `try`/`catch` where possible

Use Promise chains, custom error classes, or early validation instead.

### Avoid `any` type

Use `unknown`, generics, or proper Zod schemas instead.

### Use Bun APIs

Prefer `Bun.file()`, `Bun.write()`, `Bun.build()` over Node equivalents when possible.

## Naming Conventions

| Category          | Convention    | Examples                                    |
| ----------------- | ------------- | ------------------------------------------- |
| Files/directories | `kebab-case`  | `agent.ts`, `bus-event.ts`, `tool/`         |
| Variables/funcs   | `camelCase`   | `calculateDepth`, `defaultModel`            |
| Types/interfaces  | `PascalCase`  | `Info`, `Context`, `Logger`                 |
| Error classes     | `PascalCase`  | `RejectedError`, `BusyError`, `NotFound`    |
| Constants         | `UPPER_CASE`  | `MAX_DEPTH`                                 |

**Prefer single-word names.** Only use multi-word if you truly cannot find a single word.

```ts
// Good
const result = 1

// Bad
const queryResult = 1
```

## Import & Export Patterns

### Import ordering (observed convention)

1. Internal config: `import { Config } from "../config/config"`
2. Libraries: `import z from "zod"`
3. Internal domain: `import { Provider } from "../provider/provider"`
4. AI/LLM: `import { generateObject } from "ai"`
5. Text resources: `import PROMPT_PM from "./prompt/pm.txt"`
6. Path aliases: `import { PermissionNext } from "@/permission/next"`

### Export pattern: Namespaces

The codebase uses **namespace exports** with nested types and functions:

```ts
export namespace Agent {
  export const Info = z.object({ ... })
  export type Info = z.infer<typeof Info>
  export async function get(agent: string) { ... }
}
```

This is the dominant pattern — follow it for new modules.

## Error Handling

Custom error classes in `permission/next.ts`:
- `RejectedError` — permission rejected
- `CorrectedError` — permission corrected/modified
- `DeniedError` — permission denied
- `BusyError` (session) — session busy
- `NotFound` (context) — context not found

Throwing pattern:
```ts
if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type}`)
```

Error wrapping with cause:
```ts
throw new Error(`Tool called with invalid args: ${error}`, { cause: error })
```

Logging:
```ts
const log = Log.create({ service: "task" })
log.info("message", { key: "value" })
```

Levels: `DEBUG`, `INFO`, `WARN`, `ERROR` (defined in `util/log.ts`).
