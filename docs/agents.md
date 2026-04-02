# Agents

This document describes the seven shipped OCO agents and the configuration surface that shapes their behavior.

## `pm` (`build` and `plan`)

- Role: PM-facing planning and alignment layer
- Model: `openai/gpt-5.4`
- Why: strongest shipped default reasoning model, with named `reasoningEffort` variants via the bundled alias
- Permissions: broad editing access, but secret-oriented file reads are denied by the global permission baseline
- Spawned by: user entry point as `build`, with hidden `plan` mode available for plan-only sessions
- Prompt design: both modes use `pm.txt`; `plan` behavior is further constrained by runtime session reminders and `plan_exit`
- Configuration options: swap `model`, `prompt`, `variant`, `thinking`, `effort`, and `permission`

## `orchestrator`

- Role: execution lead for approved specs
- Model: `openai/gpt-5.4` by default
- Why: same top-tier base model as PM, but with the highest shipped reasoning setting for implementation and audit recovery
- Permissions: edit access plus the ability to call specialist subagents; completion must flow through `finish_task`
- Spawned by: PM after explicit spec approval
- Prompt design: implementation lifecycle ownership, validation, and mandatory audit loop
- Configuration options: swap model family, prompt, reasoning level, or permissions as needed

## `investigator`

- Role: internal codebase analysis
- Model: `openai/gpt-5.4-mini` by default
- Why: fast enough for deep tracing while keeping the heavier GPT-5.4 budget focused on planning and review
- Permissions: tightened to read-only in the shipped config; `glob` and `grep` allowed, shell/edit denied
- Spawned by: PM or Orchestrator when they need factual code understanding
- Prompt design: exact citations, factual reporting, no speculation
- Configuration options: change model family, effort, prompt, or tool restrictions

## `auditor`

- Role: review changed code against the approved spec
- Model: `openai/gpt-5.4` by default
- Why: uses the heavier shipped reasoning model because review quality is part of the execution contract
- Permissions: read-only; `glob` and `grep` allowed, shell/edit denied
- Spawned by: Orchestrator after substantive implementation work
- Prompt design: PASS/FAIL verdict, blocking findings vs warnings, exact file references required
- Configuration options: adjust model, prompt, effort, and restrictions as needed

## `web-search`

- Role: external web search
- Model: `openai/gpt-5.4-mini` by default
- Why: the scope is narrow and evidence-first, so the shipped config keeps it fast and inexpensive
- Permissions: `webfetch` and shell allowed, edit denied
- Spawned by: PM or Orchestrator when outside facts matter
- Prompt design: evidence-first, source URLs required, `exa-cli` via shell as the primary search path
- Configuration options: change provider/model, prompt, or web access rules

## `docs`

- Role: documentation updates
- Model: `openai/gpt-5.4-mini` by default
- Why: fast enough for prose, repo conventions, and light validation without using the heavier reasoning tier
- Permissions: documentation editing plus shell/apply-patch support in the shipped config
- Spawned by: Orchestrator when doc changes are part of the approved scope
- Prompt design: edit docs only, preserve repo style, report changed files clearly
- Configuration options: tune model, effort, and doc-specific permissions

## `compaction`

- Role: internal conversation compaction
- Model: `openai/gpt-5.4-mini` by default
- Why: hidden utility role for context compression rather than user-facing planning or execution
- Permissions: internal/hidden behavior; configured mainly so teams can inspect or override it
- Spawned by: the harness, not normal user workflow
- Prompt design: exhaustive replacement summary of prior context
- Configuration options: model family, prompt override, and effort settings

## Permission Notes

- The shipped config applies a global secret-file deny list to every agent.
- Built-in source defaults for some read-only roles are looser than their prompts imply.
- The distribution config tightens `investigator`, `auditor`, and `web-search` explicitly so the shipped behavior matches the intended role descriptions.

## Prompt Files

The distributed prompt files live in `config/prompts/`:

- `pm.txt`
- `orchestrator.txt`
- `investigator.txt`
- `auditor.txt`
- `web-search.txt`
- `docs.txt`
- `compaction.txt`

Point agents at these with `{file:prompts/<name>.txt}` in `config/oco.jsonc`.
