# OpenCodeOrchestra

[OpenCode](https://github.com/AnomalyCo/opencode) is an open-source AI coding agent that runs in your terminal. Out of the box it has two flat agents (`build` and `plan`) that share the same context.

OpenCodeOrchestra (OCO) is a fork that replaces that flat model with a structured engineering hierarchy: a PM that talks to you and drafts specs, an Orchestrator that executes them, and specialist subagents for investigation, code review, web research, and documentation. Each role has its own depth level, permissions, and model configuration — the same way a real engineering team separates planning from implementation from review.

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

## What You Get

- **Hierarchical delegation** — PM plans, Orchestrator executes, subagents do scoped work. Depth is enforced at runtime so the hierarchy doesn't collapse.
- **Spec-driven workflow** — the PM writes a spec, you approve it, then execution starts. No free-form implementation drift.
- **Audit loop** — the Orchestrator sends its changes to an Auditor for PASS/FAIL review before reporting back.
- **Clean handoff** — the Orchestrator calls `finish_task` to explicitly return control to the PM with a summary, not just "I'm done."
- **Mixed model support** — use Claude for planning and GPT for execution, or all-Claude, or all-GPT. The config documents both patterns.

| | Vanilla OpenCode | OCO |
|--|------------------|-----|
| Agent hierarchy | Flat (`build` / `plan`) | PM → Orchestrator → Subagent |
| Spec approval before execution | No | Yes |
| Audit loop | No | Yes |
| Depth enforcement | None | Enforced |
| `finish_task` | Auto | Orchestrator-triggered |

## Quick Start

**Prerequisites:** An Anthropic API key (Claude). GPT is optional. That's it — the shipped config works with Claude alone.

### For Agents
Copy and paste this prompt to your LLM agent:

```text
Install and configure OpenCodeOrchestra by following the instructions here:
https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/docs/installation.md
```

### For Humans

**Option A — From a release binary:**

```bash
# 1. Download the latest binary from GitHub Releases and put it on your PATH
#    (macOS: you may need to ad-hoc sign it first: codesign -f -s - ./oco)

# 2. Install the config and prompts
mkdir -p ~/.config/opencode/prompts
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/opencode.jsonc -o ~/.config/opencode/opencode.jsonc
for f in pm orchestrator investigator auditor researcher docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/opencode/prompts/${f}.txt
done

# 3. Authenticate and launch
oco auth login   # or: opencode auth login
oco
```

**Option B — From source:**

```bash
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpencodeOrchestra && bun install
cd packages/opencode && bun run build --single --skip-install
# Binary is at dist/@skybluejacket/oco-$(uname -s | tr A-Z a-z)-$(uname -m)/bin/oco
# Copy it to your PATH, then install config files as shown in Option A step 2.
```

Full setup guide with troubleshooting: [docs/installation.md](docs/installation.md)

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

Config and prompts live in `config/` so the hierarchy ships with the repo. See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow details.
