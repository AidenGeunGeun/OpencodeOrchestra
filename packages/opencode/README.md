# @skybluejacket/oco

OpenCode Orchestra — a multi-agent CLI with a three-tier hierarchy for structured AI-driven development.

## Install

```bash
npm install -g @skybluejacket/oco
```

This installs a lightweight wrapper that automatically downloads the correct binary for your platform (macOS, Linux, Windows).

## Agent Hierarchy

OCO uses a three-tier depth-enforced agent system:

| Depth | Role             | Agents                                                        | Mode      |
|-------|------------------|---------------------------------------------------------------|-----------|
| 0     | Project Manager  | `build` (PM Build), `plan` (PM Plan)                         | primary   |
| 1     | Orchestrator     | `orchestrator`                                                | subagent  |
| 2+    | Subagents        | `investigator`, `auditor`, `researcher`, `cleanup`, `docs`    | subagent  |

**Flow**: PM (depth 0) spawns Orchestrator (depth 1) which spawns subagents (depth 2+, forced singleShot).

### Agent Prompts

All agents have system prompts in `src/agent/prompt/`:

| Agent         | Prompt File        | Import Constant       |
|---------------|--------------------|-----------------------|
| PM Build      | `pm.txt`           | `PROMPT_PM`           |
| PM Plan       | `pm-plan.txt`      | `PROMPT_PM_PLAN`      |
| Orchestrator  | `orchestrator.txt` | `PROMPT_ORCHESTRATOR`  |
| Investigator  | `investigator.txt` | `PROMPT_INVESTIGATOR`  |
| Auditor       | `auditor.txt`      | `PROMPT_AUDITOR`       |
| Researcher    | `researcher.txt`   | `PROMPT_RESEARCHER`    |
| Cleanup       | `cleanup.txt`      | `PROMPT_CLEANUP`       |
| Docs          | `docs.txt`         | `PROMPT_DOCS`          |

Prompts are imported and assigned in `src/agent/agent.ts`. Every agent MUST have a `prompt:` field.

### Model Configuration

No per-agent model assignments by default — all agents inherit from `Provider.defaultModel()` or the parent session's model. Per-agent models can be configured via `opencode.json`:

```json
{
  "agent": {
    "orchestrator": {
      "model": "provider/model-id"
    }
  }
}
```

## Built-In Tools

### Project State

Cross-session memory for PM agents (depth 0 only). Subagents cannot access it.

| Tool                   | Purpose                                              |
|------------------------|------------------------------------------------------|
| `project_state_read`   | Read objectives, decisions, learnings, todos         |
| `project_state_write`  | Update fields (replaces entire arrays per field)     |

**Storage**: `.opencode/project-state.md` in project root.

PM reads at session start to restore context. Writes when decisions are made, tasks complete, or insights are discovered. This is the only mechanism for context to survive across sessions.

### Finish Task

Used by Orchestrator (depth 1) to signal task completion and return control to PM.

### Task

Spawns sub-agents. Calculates depth via parentID chain. Enforces singleShot for depth 2+.

## Build

```bash
bun install
bun run build --single    # current platform only
bun run build             # all 11 platform targets
```

## Publish

See `script/publish.ts` header for full instructions. Summary:

```bash
# Set npm automation token (create at npmjs.com → Access Tokens → Automation)
export NPM_TOKEN=npm_xxxxxxxxxxxx    # macOS/Linux
set NPM_TOKEN=npm_xxxxxxxxxxxx       # Windows cmd

# Build + publish all 12 packages
bun run script/publish.ts
```

Publishes 11 platform binaries + 1 main wrapper to npm under `@skybluejacket` scope.
