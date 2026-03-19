# OpenCodeOrchestra

OpenCodeOrchestra turns OpenCode into a structured engineering hierarchy: PM for alignment, Orchestrator for execution, specialist subagents for investigation, review, research, and docs. Real teams do not collapse planning, implementation, and review into one role. Your agent harness should not either.

The point is structure, not feature count. OCO makes specs and verification the alignment mechanism, enforces session depth, and gives execution a clean return path back to the user-facing PM.

## Architecture

```text
User
  |
  v
PM (Depth 0) - holds context, drafts specs, makes design decisions
  |
  +---> Orchestrator (Depth 1) - executes approved specs
  |         |
  |         +---> Investigator - read-only codebase analysis
  |         +---> Auditor - code review, PASS/FAIL verdict
  |         +---> Researcher - external web research
  |         +---> Docs - documentation updates
  |
  v
User reviews, approves, or redirects
```

## Agent Roles

| Agent | Depth | Model | Role | Key Constraint |
|-------|-------|-------|------|----------------|
| `build` / `plan` | 0 | `anthropic/claude-opus-4-6` | PM-facing planning, specification, user alignment | Must get explicit approval before execution handoff |
| `orchestrator` | 1 | `anthropic/claude-sonnet-4-6` by default | Executes approved specs and owns validation | Must return control via `finish_task` |
| `investigator` | 2+ | `anthropic/claude-sonnet-4-6` by default | Internal codebase analysis | Read-only, no editing |
| `auditor` | 2+ | `anthropic/claude-sonnet-4-6` by default | Review against spec, PASS/FAIL | Read-only, scoped review only |
| `researcher` | 2+ | `anthropic/claude-sonnet-4-6` by default | External web research | Web-only, no editing |
| `docs` | 2+ | `anthropic/claude-sonnet-4-6` by default | Documentation updates | Docs scope only |
| `compaction` | internal | `anthropic/claude-sonnet-4-6` by default | Context compression | Hidden internal agent |

## Workflow

1. User describes intent to PM.
2. PM investigates and drafts a spec.
3. User approves the spec.
4. PM spawns the Orchestrator.
5. Orchestrator implements through focused subagents.
6. Auditor reviews the full changeset.
7. Orchestrator reports terminal state with `finish_task`.
8. PM reports back to the user with validation results and follow-ups.

## Feature Highlights

- Hierarchical agent delegation with enforced depth boundaries
- Spec-driven workflow instead of free-form implementation drift
- Audit loop: Orchestrator -> Auditor -> fix -> re-audit
- `finish_task` for explicit control return from execution to PM
- AI SDK 6.x with Claude 4.6 adaptive thinking support
- Works with Claude-only, GPT-only, or mixed model setups

## Comparison

| Feature | Vanilla OpenCode | OCO |
|---------|------------------|-----|
| Agent hierarchy | Flat (`build` / `plan`) | PM -> Orchestrator -> Subagent |
| Spec-driven | No | Yes |
| Audit loop | No | Yes |
| Depth enforcement | None | Enforced |
| `finish_task` | Auto | Orchestrator-triggered |
| AI SDK | 5.x | 6.x |

### For Agents
Copy and paste this prompt to your LLM agent:

```text
Install and configure OpenCodeOrchestra by following the instructions here:
https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/docs/installation.md
```

## For Humans

1. Download the latest release from GitHub Releases, or build from source.
2. Copy `config/opencode.jsonc` to `~/.config/opencode/opencode.jsonc`.
3. Copy `config/prompts/` to `~/.config/opencode/prompts/`.
4. Authenticate your model providers with `oco auth login` or `opencode auth login`.
5. Start `oco` and verify the PM agent is the default entry point.

Detailed setup steps: `docs/installation.md`

## Documentation

- `docs/installation.md` - agent-followable and human-readable install guide
- `docs/architecture.md` - why the hierarchy is structured this way
- `docs/agents.md` - prompt, model, and permission design per agent
- `docs/customization.md` - model swaps, permissions, MCPs, plugins, and recipes
- `UPSTREAM-DIFF.md` - code-level divergence from upstream `opencode` 1.2.5

## Development

```bash
cd packages/opencode
bun test
```

The current release-ready config and prompts live in `config/` so the hierarchy can be distributed with the repo instead of depending on a maintainer's local machine.
