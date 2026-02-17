# OpenCodeOrchestra (OcO)

**A spec-driven agentic workflow framework for long-term context programming.**

OpenCodeOrchestra is a fork of [opencode](https://github.com/anomalyco/opencode) (v1.2.5) that implements a structured PM -> Orchestrator -> Subagent hierarchy for complex, multi-session development tasks.

---

## Installation

Download the latest release from [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases), or build from source:

```bash
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpenCodeOrchestra
bun install
cd packages/opencode
bun run build --single --skip-install
```

Copy the binary to your PATH:
```bash
cp dist/@skybluejacket/oco-linux-x64/bin/oco ~/.local/bin/oco
```

Then run:
```bash
oco
```

---

## Key Features

- **Spec-Driven Workflow** - Specs and tests are the alignment mechanism between user intent and code
- **Hierarchical Delegation** - Clear depth-based agent hierarchy with enforced boundaries
- **Agent Type Inheritance** - Subagent sessions preserve their agent type, model, and system prompt
- **SQLite Storage** - Fast, reliable session/message storage with automatic JSON migration
- **User-Controlled Flow** - User approves specs, triggers finish_task, and resolves escalations

---

## Architecture

```
User
  |
  v
PM (Depth 0) -----> Holds long-term context, drafts specs, advises on design
  |
  +--[spawn orchestrator]--> Orchestrator (Depth 1) -----> Executes approved specs
  |                                |
  |                                +--[spawn sub-agents]--> Depth 2+
  |
  +--[spawn sub-agents directly]--> Depth 2 (skips depth 1)
```

### Agent Roles

| Agent | Depth | Purpose |
|-------|-------|---------|
| **PM** | 0 | Long-term context, spec drafting, design decisions |
| **Orchestrator** | 1 | Executes approved specs, delegates to sub-agents |
| **Investigator** | 2+ | Codebase analysis (read-only) |
| **Researcher** | 2+ | External web research (read-only) |
| **Auditor** | 2+ | Code review, issues PASS/FAIL verdict |
| **Cleanup** | 2+ | Removes @TODO markers after Auditor PASS |
| **Docs** | 2+ | Documentation updates |

### Workflow

1. **User describes intent to PM** - Plain language, focus on what and why
2. **PM drafts spec + test cases** - Written for user to understand
3. **User reviews and approves** - "If these tests pass, I'm satisfied"
4. **PM spawns Orchestrator** - Hands off approved spec
5. **Orchestrator executes via sub-agents** - Implements in phases
6. **Orchestrator escalates if needed** - User decides, Orchestrator continues
7. **User triggers finish_task** - Control returns to PM
8. **PM updates records** - Decisions logged, context preserved

---

## Navigation

- `Tab` - Switch between PM modes (Plan/Build)
- `Ctrl+X Up/Down` - Navigate parent/child sessions (depth traversal)
- `Ctrl+X Left/Right` - Navigate sibling sessions (same depth)
- Agent type and model automatically match when entering subagent sessions

---

## Configuration

Config files are loaded in priority order:
1. `./opencode.json` or `./opencode.jsonc` (project-specific)
2. `~/.config/opencode/opencode.jsonc` (global)

---

## Key Differences from Upstream opencode

| Feature | OpenCode | OpenCodeOrchestra |
|---------|----------|-------------------|
| Agent Hierarchy | Flat (build/plan) | PM -> Orchestrator -> Subagent |
| Depth Enforcement | None | Orchestrator at depth 1 only |
| Spec-Driven | No | Yes, specs + tests as alignment |
| finish_task | Auto | User-triggered at depth 1 |
| Agent Inheritance | None | Session preserves agent type + model |
| Removed Agents | - | general, explore (disabled) |

---

## Development

```bash
# Run tests (878 pass / 29 skip / 0 fail)
cd packages/opencode && bun test

# Typecheck
tsgo --noEmit

# Rebuild after changes
bun run build --single --skip-install
```

---

## License

This project is a fork of [opencode](https://github.com/anomalyco/opencode) and maintains the same license terms.

---

**Note:** This project is not affiliated with the original OpenCode team. It is an independent fork focused on structured agentic workflows for long-term context programming.
