# opencode agent guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Run**: `bun run --conditions=browser ./src/index.ts`
- **Typecheck**: `bun run typecheck` (`tsgo --noEmit`)
- **Test**: `bun test` (runs all tests — 884 pass / 29 skip / 0 fail)
- **Single test**: `bun test ./test/tool/tool.test.ts` (note the `./` prefix)
- **Build**: `bun run build --single --skip-install` (single-platform binary)
- **SDK regen**: `bunx @hey-api/openapi-ts` (from `packages/sdk/js`)

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Zod schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)
- **Formatting**: Prettier with `semi: false`, `printWidth: 120`, 2-space indent

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: SQLite via drizzle-orm (`Database.use()` / `Database.transaction()`). Legacy JSON sidecar for `agentID`.
- **AI SDK**: v6.x ecosystem (`ai@6.0.90`, `@ai-sdk/anthropic@3.0.45`). Claude 4.6 uses adaptive thinking.
- **API Client**: The TypeScript TUI (built with SolidJS + OpenTUI) communicates with the OpenCode server using `@opencode-ai/sdk`. When adding/modifying server endpoints in `packages/opencode/src/server/server.ts`, run `./script/generate.ts` to regenerate the SDK and related files.
