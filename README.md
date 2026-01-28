# OpenCodeOrchestra (OcO)

**A spec-driven agentic workflow framework for long-term context programming.**

OpenCodeOrchestra is a fork of [opencode](https://github.com/anomalyco/opencode) that implements a structured PM -> Orchestrator -> Subagent hierarchy for complex, multi-session development tasks.

---

## Key Features

- **Spec-Driven Workflow** - Specs and tests are the alignment mechanism between user intent and code
- **Long-Term Context** - PM agent maintains persistent memory across sessions via `project-state.md`
- **Hierarchical Delegation** - Clear depth-based agent hierarchy with enforced boundaries
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
| **Cleanup** | 2+ | Removes TODO markers after Auditor PASS |
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

## Installation

```bash
# Clone the repository
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpenCodeOrchestra

# Install dependencies
bun install

# Build
cd packages/opencode
OPENCODE_VERSION=0.0.2 bun run build --single

# Binary output: dist/@opencodeorchestra/cli-windows-x64/bin/OcOrchestra.exe
```

---

## Usage

```bash
# Run the CLI
oco

# Or run the binary directly
./OcOrchestra.exe
```

### Navigation

- `Tab` - Switch between PM modes (Plan/Build)
- `Ctrl+X` - Navigate agent hierarchy (depth traversal)

### Configuration

Config files are loaded in priority order:
1. `./opencode.json` (project-specific)
2. `~/.config/opencode/opencode.json` (global)

---

## Key Differences from Upstream

| Feature | OpenCode | OpenCodeOrchestra |
|---------|----------|-------------------|
| Agent Hierarchy | Flat | PM -> Orchestrator -> Subagent |
| Depth Enforcement | None | Orchestrator at depth 1 only |
| Long-term Context | None | `project-state.md` persistence |
| Spec-Driven | No | Yes, specs + tests as alignment |
| finish_task | Auto | User-triggered |
| Removed Agents | - | general, explore |

---

## Development

```bash
cd packages/opencode

# Run tests
bun test

# Typecheck
bun run typecheck

# Build with version
OPENCODE_VERSION=x.x.x bun run build --single
```

---

## License

This project is a fork of [opencode](https://github.com/anomalyco/opencode) and maintains the same license terms.

---

**Note:** This project is not affiliated with the original OpenCode team. It is an independent fork focused on structured agentic workflows for long-term context programming.
