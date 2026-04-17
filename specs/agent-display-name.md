# Agent `displayName` Field

## Problem

OCO's UI selectors (TUI and Desktop) currently render agents by their raw identifier (`agent.name`). This creates two friction points:

1. The built-in primary agent identifier is `build` — inherited from upstream OpenCode. In the OCO mental model, implementation responsibility belongs to the Orchestrator; the primary (depth-0) agent is a PM, not a builder. Displaying `build` in the selector is semantically misleading.

2. The `plan` agent is hidden by default but becomes visible in the selector when plan mode is active. When it does, the label flips from `build` to `plan`, even though both agents share the same `PROMPT_PM`, `mode: "primary"`, color, and singleShot behavior — they only differ in permission profiles (plan-enter vs. plan-exit, edit restrictions). From the user's perspective, there is one PM persona, not two.

A previous patch removed a hardcoded `"PM"` alias from three TUI surfaces. That restored consistency (both TUI and Desktop now render raw names) but lost the semantic benefit of labeling the PM role as "PM". The alias was the wrong layer; the fix is a proper schema field.

## Intent

Add an optional `displayName` field to agent configuration and the `Agent.Info` schema. UIs render `agent.displayName ?? agent.name`. Built-in agents `build` and `plan` both receive `displayName: "PM"` so they appear as a unified "PM" in selectors regardless of which permission profile is active. Users can override `displayName` for any agent (built-in or custom) in their `oco.jsonc`.

This is a **display-layer addition**. The agent identifier `build` remains canonical throughout the codebase — no rename, no migration, no persistence changes, no SDK break.

## Scope

**In scope:**
- `packages/opencode/src/agent/agent.ts` — add `displayName` to the `Agent.Info` schema, default it on the `build` and `plan` built-ins, and apply config overrides in the merge loop alongside `description` / `color` / etc.
- `packages/opencode/src/config/config.ts` — add `display_name` to the agent config schema so users can set it via `oco.jsonc`
- `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx` — render `agent.displayName ?? agent.name` in both the locked-agent branch and the default branch
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — any user-facing agent label rendering
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — any user-facing agent label rendering
- `packages/app/src/components/prompt-input.tsx` — `agentNames()` memo and `Select` rendering should use display name when available
- `packages/app/src/context/local.tsx` — if any label surfaces here, update
- Tests: add coverage for `displayName` resolution, default values on built-ins, config override behavior, and fallback when unset
- SDK regeneration: `bunx @hey-api/openapi-ts` in `packages/sdk/js/`

**Out of scope:**
- Renaming the `build` or `plan` identifiers
- Changing agent permission profiles, prompts, or behavior
- Persistence migration
- Session restoration changes
- CLI command surface (`--agent build` continues to work exactly as before)
- `description` field — unchanged; `displayName` is strictly for the selector label

## Context

Current state:
- `build` and `plan` are both `mode: "primary"`, `native: true`, share `PROMPT_PM`, share color `#FFC400`, share `singleShot: false`. They differ only in permissions: `build` has `plan_enter: "allow"`, `plan` has `plan_exit: "allow"` plus plan-markdown-scoped edit allowlist.
- `plan` has `hidden: true` and only appears in the selector when actively toggled via plan mode.
- The agent merge loop at `agent.ts:347-361` already propagates `description`, `color`, `temperature`, `topP`, `mode`, `hidden`, `name`, `steps`, `variant`, `singleShot`, and `options` from config to the final `Info`. Add `displayName` to this list.
- Config schema for agents is at `config.ts:1077-1087` (both deprecated `mode` and current `agent` sections). The schema field should be named `display_name` (snake_case to match the file's convention, e.g., `single_shot`) and map to `displayName` on the resolved `Info`.
- TUI previously had a hardcoded `agent.name === "build" || agent.name === "plan" ? "PM" : agent.name` alias in three files. That alias was removed in patch `tui-selector-alias-removal.md`. The `displayName` field supersedes what that alias was trying to achieve, now as a proper abstraction.
- Desktop selector at `prompt-input.tsx:1446-1456` uses `agentNames()` which returns raw names and `class="capitalize"` for initial-letter casing. After this change, if `displayName` is set, skip the CSS capitalize or let it apply — `"PM"` is already uppercase so capitalize is a no-op; `"Niggie"` as displayName is already capitalized. The CSS class can stay as a graceful fallback for unset displayName cases.
- The Niggie project's `oco.jsonc` will get a `"display_name": "Niggie"` entry to demonstrate the feature works for custom agents and to provide proper casing without relying on CSS.

## Acceptance Criteria

- `Agent.Info` schema includes optional `displayName: string | undefined`
- Config schema (`config.ts`) accepts `display_name` on both `mode.*` (deprecated) and `agent.*` entries
- Built-in `build` and `plan` both have `displayName: "PM"` by default
- User config `display_name` overrides the built-in default when provided
- TUI selector shows `"PM"` for both `build` and `plan`
- Desktop selector shows `"PM"` for `build` (and for `plan` when it becomes visible in plan mode)
- Subagent locked-session view in the TUI uses `displayName` when present
- Agents without `displayName` render `name` (current behavior preserved for `niggie`, `investigator`, `auditor`, etc. unless a user sets one)
- `niggie` in `/Users/aidenkim/projects/agents/Niggie/oco.jsonc` gets `"display_name": "Niggie"` added to demonstrate customization
- SDK regenerated so the field surfaces in `@opencode-ai/sdk/v2`
- `bun run --cwd packages/opencode typecheck` passes
- `bun turbo test` passes, including new coverage for `displayName` defaulting and override

## Verification

1. `bun run --cwd packages/opencode typecheck` green
2. `bun turbo test` green — existing tests untouched (identifier `build` preserved), new tests for displayName resolution pass
3. SDK regen: `bunx @hey-api/openapi-ts` in `packages/sdk/js/`. Confirm `Agent.Info` in generated types includes `displayName`. Do NOT commit unrelated SDK churn from the regen — restore any incidental diff
4. Local TUI build: `bun run build --single` in `packages/opencode` → install to `~/.local/bin/oco` → re-sign with `codesign -f -s -`
5. Local Dev desktop build: `bunx tauri build` in `packages/desktop`. Install `OpenCodeOrchestra Dev.app` to `/Applications/` for side-by-side validation per root `AGENTS.md`
6. Manual check list (handed to PM for the user):
   - Open TUI in any project → agent selector shows `PM` for the primary
   - Open TUI in `~/projects/agents/Niggie/` → selector shows `Niggie`
   - Trigger plan mode in TUI (any PM session) → selector still reads `PM` (not `plan`)
   - Open Desktop Dev app → agent selector in session mirrors the TUI
   - Subagent session in TUI → locked selector shows subagent's displayName or raw name (no regression)
7. Grep check: no remaining hardcoded `"PM"` strings outside of the built-in defaults in `agent.ts`

## Completion Standard

- Schema field added with correct snake_case / camelCase mapping
- Built-in defaults set
- All four listed UI surfaces (TUI dialog, TUI prompt, TUI session route, Desktop prompt-input) updated to use `displayName ?? name`
- SDK regenerated cleanly (only the schema delta, no unrelated churn)
- Typecheck and tests green with new coverage
- Local TUI binary installed and Dev desktop app rebuilt + installed for the user's visual check
- `/Users/aidenkim/projects/agents/Niggie/oco.jsonc` updated with `"display_name": "Niggie"` on the `niggie` agent
- Hand back to PM. Do NOT trigger `bun run release` — the user reviews the visual behavior and approves `1.1.4` release separately

## Release Notes

**Bundled with patch `tui-selector-alias-removal.md` into a single `1.1.4` release.** The alias removal is already patched locally; this spec builds on top of that baseline.

Per root `AGENTS.md` release matrix, this is a **feature** change affecting both TUI and Desktop surfaces plus a minor SDK schema addition. Validation path:

> **Low-risk, additive, non-breaking** (new optional field, no behavior change for users who don't set it) — Validate against the **prod** desktop app after also running Dev app side-by-side for schema-regen sanity.

After user approval of the visual check:

```sh
bun run release 1.1.4
git push origin main && git push origin oco-v1.1.4
```
