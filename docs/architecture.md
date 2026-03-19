# Architecture

OpenCodeOrchestra organizes agent work by responsibility, not by raw tool access.

## Depth 0: PM

- The PM is the only long-lived, user-facing agent.
- It holds domain context across sessions, investigates intent, drafts specs, and asks for approval.
- It should not be the primary implementation engine.
- In practice this is the `build` agent, with hidden `plan` mode available for plan-first work.

## Depth 1: Orchestrator

- The Orchestrator is the execution boundary.
- It receives an approved spec and owns implementation, validation, and the audit loop.
- It is the only persistent execution subagent.
- It must explicitly signal completion with `finish_task` so control returns cleanly to the PM.

## Depth 2+: Disposable Subagents

- `investigator` handles internal codebase analysis.
- `auditor` reviews the full scoped changeset and returns PASS or FAIL.
- `researcher` gathers external facts.
- `docs` updates documentation.
- These sessions are intentionally disposable, single-shot, and narrowly scoped.

## Why The Depth Model Matters

- Depth 0 keeps user alignment and long-range context in one place.
- Depth 1 isolates execution from user-facing planning.
- Depth 2+ keeps context lean and reduces tool/prompt bleed between roles.
- Runtime depth enforcement prevents the hierarchy from collapsing back into flat agent sprawl.

## Spec-Driven Workflow

1. User states the goal.
2. PM investigates the codebase and any external context it needs.
3. PM writes an execution-ready spec.
4. User approves the spec.
5. PM spawns the Orchestrator against that spec.
6. Orchestrator implements and validates.
7. Auditor reviews the entire changeset.
8. Orchestrator returns control to the PM through `finish_task`.
9. PM reports completion, risks, and follow-ups to the user.

Specs are not decoration. They are the contract between intent and execution.

## Escalation Model

- PM escalates when product intent, architecture, security, or UX workflow needs user alignment.
- Orchestrator escalates when the approved spec must materially change, when work becomes destructive, or when a real blocker remains after investigation.
- Subagents do not own product decisions. They return findings to the caller that spawned them.

## Audit Loop

- Orchestrator finishes implementation.
- Orchestrator sends the full change report to a fresh Auditor.
- Auditor returns PASS or FAIL.
- On FAIL, Orchestrator fixes the issues, reruns validation, and re-audits with a fresh Auditor.
- On PASS, Orchestrator calls `finish_task` with outcome, validation, and follow-ups.

This keeps review as an explicit phase instead of an implied best effort.

## Model Configuration By Family

OCO is designed to support mixed-model setups, but the shipped config defaults to Claude so it works without GPT access.

### Claude Pattern

- Use `thinking: { type: "adaptive" }`
- Pair it with an `effort` level such as `medium`, `high`, or `max`
- This is the AI SDK 6 / provider 3.x style used for Claude 4.6 models

### GPT Pattern

- Use `reasoningEffort`
- Typical values are `none`, `low`, `medium`, `high`, and `xhigh`
- This is separate from Claude's adaptive thinking configuration

### Shipped Default

- PM agents use `anthropic/claude-opus-4-6`
- Subagents use `anthropic/claude-sonnet-4-6`
- You can swap any of them in `config/opencode.jsonc`

For exact model and permission examples, see `docs/agents.md` and `docs/customization.md`.
