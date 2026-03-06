# Upstream Selective Sync

## Intent

Selectively adopt upstream `v1.2.6` to `v1.2.18` changes that materially improve OpenCodeOrchestra stability and recovery without introducing large architectural churn or risking the AI SDK 6.x fork divergence.

## Goals

- Improve provider error handling for `413` and HTML gateway/proxy responses.
- Add safer auto-compaction recovery for context overflow scenarios.
- Reduce memory pressure in the `read` tool for large files.
- Fix attachment identity consistency for tool and MCP outputs.
- Prevent mutable part payloads from corrupting bus event consumers.
- Harden TUI worker shutdown while preserving OCO's existing `SIGHUP` protection.
- Upgrade `@opentui/core` and `@opentui/solid` to the newer upstream-compatible patch level.

## Constraints

- Preserve all OCO-specific AI SDK 6.x behavior, especially in `packages/opencode/src/session/index.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/prompt.ts`, and `packages/opencode/src/provider/transform.ts`.
- Do not adopt upstream remote workspace, control-plane, or config split in this batch.
- Do not perform wholesale `Bun.file()` to `Filesystem` migration in this batch.
- Prefer targeted manual merges over broad cherry-picks in diverged files.

## In Scope

- `packages/opencode/src/provider/error.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/index.ts`
- `packages/opencode/src/tool/read.ts`
- `packages/opencode/src/cli/cmd/tui/thread.ts`
- `packages/opencode/package.json`

## Out of Scope

- `packages/opencode/src/config/config.ts` split
- `packages/opencode/src/config/tui.ts` and `OPENCODE_TUI_CONFIG`
- `packages/opencode/src/control-plane/`
- `workspace_id` schema and session partitioning
- Desktop, app, and UI-only upstream changes
- Windows-only compatibility sweeps
- Full process abstraction rollout via `packages/opencode/src/util/process.ts`

## Acceptance Criteria

1. `packages/opencode/src/provider/error.ts` treats HTTP `413` as context overflow and avoids dumping raw HTML gateway pages to users.
2. `packages/opencode/src/session/compaction.ts` and `packages/opencode/src/session/prompt.ts` support overflow-aware auto-compaction with replay and continuation behavior adapted safely to OCO.
3. `packages/opencode/src/tool/read.ts` reads large text files in a streaming manner instead of loading the full file into memory.
4. Tool and MCP attachments saved through `packages/opencode/src/session/prompt.ts` always receive the required identifiers and session linkage.
5. `packages/opencode/src/session/index.ts` publishes cloned part payloads to bus listeners where needed, without regressing OCO's AI SDK 6.x delta-aware `updatePart()` behavior.
6. `packages/opencode/src/cli/cmd/tui/thread.ts` retains current `SIGHUP` behavior and improves shutdown robustness with bounded cleanup and worker termination.
7. `packages/opencode/package.json` upgrades `@opentui/core` and `@opentui/solid` to the selected upstream level without breaking build or test.

## Approach

- Apply low-risk direct upstream logic in isolated files.
- Manually transplant only the small, relevant hunks in diverged files such as `packages/opencode/src/session/prompt.ts` and `packages/opencode/src/session/index.ts`.
- Keep OCO implementations when they are already stronger than upstream, especially where OCO has AI SDK 6.x-specific semantics or existing process protections.

## Risks And Mitigations

- Risk: `packages/opencode/src/session/prompt.ts` merge conflicts could break loop continuation or attachment handling.
  - Mitigation: limit prompt changes to narrowly scoped upstream fixes only.
- Risk: `packages/opencode/src/session/index.ts` event publishing changes could interfere with OCO's delta streaming behavior.
  - Mitigation: preserve OCO's `updatePart()` API and only clone the published payload where needed.
- Risk: `@opentui` upgrade may surface rendering or type changes indirectly.
  - Mitigation: run targeted validation first, then full package validation.

## Verification Commands

- `bun run build --single --skip-install`
- `tsgo --noEmit`
- `bun test`
- Optional focused iteration: `bun test packages/opencode/test`

## Test Cases

### Error Handling

- Given a provider or proxy returns HTTP `413`, when request processing fails, then the error is classified as context overflow and routed into the compaction or recovery flow.
- Given a provider returns an HTML error page, when the error is surfaced, then the user sees a readable message instead of raw HTML.

### Compaction Recovery

- Given a large conversation with oversized media or context, when overflow occurs, then compaction runs and the session either resumes safely or emits the clearer overflow failure message.
- Given auto-compaction replays a prior user request, when continuation resumes, then the replayed message preserves the necessary non-compaction user content without reintroducing oversized media.

### Read Tool

- Given a large text file, when `read` is called with `offset` and `limit`, then output formatting remains correct and the implementation does not require full-file text loading.
- Given a binary file, image, PDF, or directory, when `read` is called, then existing non-text behavior still works.

### Attachments And Events

- Given a tool or MCP result includes attachments, when the result is persisted or rendered, then each attachment has stable `id`, `messageID`, and `sessionID`.
- Given streaming part updates and bus subscribers, when part events are published, then downstream consumers do not observe later mutation corruption.

### TUI Shutdown

- Given the TUI exits normally or on terminal close, when shutdown runs, then the worker is cleaned up and no orphan remains.
