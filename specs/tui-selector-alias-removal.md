# TUI Agent Selector — Remove "PM" Alias for `build` and `plan`

## Problem

The TUI agent selector displays `build` and `plan` agents as "PM" instead of their raw names, while all other agents (`orchestrator`, `investigator`, `auditor`, `web-search`, `docs`, custom agents) render with their raw names. The Desktop app displays all agents with raw names consistently (capitalized via CSS).

This creates a UI inconsistency between the two clients and a semantic inconsistency within the TUI itself: only two specific built-in agents get a special alias, with no configuration mechanism to control it. The alias was introduced to rename the default primary agents to match the PM-Orchestrator-Subagent mental model, but it hardcodes assumptions that break as soon as:

- A user defines a custom primary agent with a different persona (e.g., `niggie` as a life-mentor agent)
- `build`/`plan` are disabled in a project scope via `disable: true`
- The user wants the actual agent name surfaced for debugging or clarity

## Intent

Remove the hardcoded `"PM"` alias from the TUI agent selector so both TUI and Desktop display agent names consistently using the raw `agent.name` field. This matches the existing behavior for every other agent in both UIs.

## Scope

- `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx` — the only file containing the alias logic
- Any other TUI surface that renders agent names in a user-facing selector/dropdown/label (verify none exist with a similar alias pattern)

Not in scope:
- Desktop app — already renders raw names correctly
- Agent schema — no `displayName` field or similar abstraction is being introduced
- Agent defaults — `build` and `plan` remain the default primary agent names; only their display is changed

## Context

Current code at `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx:35-47` contains two ternaries that map `build`/`plan` to `"PM"`:

```
title: agent.name === "build" || agent.name === "plan" ? "PM" : agent.name
```

These appear both in the locked-subagent branch (line 36) and the default branch (line 46). Both must be updated to use `agent.name` directly.

Desktop reference implementation at `packages/app/src/components/prompt-input.tsx:1446-1456` uses `agentNames()` which maps `local.agent.list()` to raw `agent.name` values, with CSS `class="capitalize"` handling the initial capitalization. The TUI does not need capitalization changes — TUI uses lowercase agent names consistently.

The `native` flag distinction (line 37, 47) — "locked"/"native" description for built-in agents — is unrelated to the name display and should remain untouched.

## Acceptance Criteria

- TUI agent selector shows `build` instead of `PM` for the `build` agent
- TUI agent selector shows `plan` instead of `PM` for the `plan` agent
- All other agents display unchanged
- Custom primary agents (e.g., a user-defined `niggie`) display their raw name in the TUI selector
- Subagent locked session view (when `lockedAgentID()` is truthy) shows the raw name of the locked agent
- The `"native"` / `"locked"` description behavior for built-in agents is preserved

## Verification

1. Build a local TUI binary: `bun run build --single` in `packages/opencode`
2. Swap into `~/.local/bin/oco` and re-sign: `codesign -f -s - ~/.local/bin/oco`
3. Open the TUI in any project with the default global config (where `build` is the primary agent) — the agent selector dropdown should show `build`, not `PM`
4. Open the TUI in `~/projects/agents/Niggie` — the selector should show `niggie` (already correct today, but confirm unchanged)
5. Open a subagent session (e.g., trigger an `investigator` task from the PM) and open the locked selector — it should show the raw subagent name
6. Verify the Desktop app still displays the same raw names (no regression — no Desktop code touched, but sanity-check the flow is unchanged)

## Completion Standard

- Single-file patch to `dialog-agent.tsx` with both ternaries replaced
- `bun run --cwd packages/opencode typecheck` passes (`tsgo --noEmit`)
- `bun turbo test` passes
- Local TUI validation per Verification section confirms raw names display
- No test file needs to be added — the alias logic had no dedicated test; the removal simplifies existing behavior
- Hand back to PM for user approval before triggering `bun run release`

## Release Notes

This is a **low-risk, TUI-only change**. Per the release matrix in `AGENTS.md`:

> **TUI/CLI-only change** — Validate by replacing `~/.local/bin/oco` with the freshly built binary and re-signing. No desktop rebuild needed.

After user approval of the patch + local check, release follows the standard push-and-forget flow:

```
bun run release X.Y.Z
git push origin main && git push origin oco-vX.Y.Z
```

Version bump should reflect the cosmetic UX nature of the change — patch-level bump.
