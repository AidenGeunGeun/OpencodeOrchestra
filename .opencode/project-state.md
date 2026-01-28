# OpenCodeOrchestra (OcO) - Project State

**Last Updated:** 2026-01-29
**Root Path:** `C:\Academic\Projects\OpenCodeWorkspace\OpenCodeOrchestra`
**Repo:** `https://github.com/AidenGeunGeun/OpencodeOrchestra` (branch: `main`)
**Build Target:** CLI/TUI only (No GUI)

---

## Current State

- **Version:** 0.0.2
- **Binary:** `OcOrchestra.exe`
- **CLI Command:** `oco`
- **Tests:** 808 pass, 0 fail
- **Typecheck:** 100% SUCCESS

---

## Architecture: Spec-Driven Agentic Workflow

### Depth Hierarchy

```
Depth 0: PM (Plan/Build modes) - User's primary interface
         |
         +--[spawn orchestrator]--> Depth 1: Orchestrator (ONLY orchestrator here)
         |                                   |
         |                                   +--[spawn sub-agents]--> Depth 2+: investigator, researcher, etc.
         |
         +--[spawn sub-agents directly]--> Depth 2: investigator, researcher, etc.
                                          (skips depth 1)
```

### Key Rules

| Rule | Description |
|------|-------------|
| PM spawns orchestrator | Goes to depth 1 |
| PM spawns non-orchestrator | Goes to depth 2 (skips depth 1) |
| Orchestrator spawns anything | Goes to depth 2+ |
| `finish_task` | User-triggered, not auto-called |
| PM | Has full tool access |
| Only orchestrator at depth 1 | Enforced in task.ts |

### Agent Definitions

| Agent | Mode | singleShot | Description |
|-------|------|------------|-------------|
| pm | primary | false | Long-term context, drafts specs, spawns orchestrators |
| orchestrator | subagent | false | Executes approved specs, spawns sub-agents |
| investigator | subagent | true | Codebase analysis (READ-ONLY) |
| researcher | subagent | true | External web research |
| auditor | subagent | true | Code review at TODO markers |
| cleanup | subagent | true | Remove TODOs after Auditor PASS |
| docs | subagent | true | Documentation updates only |

---

## Recent Changes (2026-01-29)

### Depth Hierarchy Implementation
- **task.ts:** PM->orchestrator=depth1, PM->non-orchestrator=depth2, else currentDepth+1
- **agent.ts:** Added PM agent (primary, singleShot:false, project_state permissions)
- **agent.ts:** Added Orchestrator agent (subagent, singleShot:false, finish_task permission)
- **prompt/pm.txt:** RFC 2119 prompt defining PM role, modes, constraints
- **prompt/orchestrator.txt:** RFC 2119 prompt defining Orchestrator workflow

### Branding & Theme (prior)
- Display name: "OpenCodeOrchestra"
- CLI command: `oco`
- Terminal titles: "OCO | {session}"
- Theme: Restored upstream purple/blue (#9d7cd8, #5c9cf5)

---

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Only orchestrator at depth 1 | Clear hierarchy, navigation simplicity | 2026-01-29 |
| PM has full tool access | Design decisions need investigation | 2026-01-29 |
| finish_task is user-triggered | User controls session flow | 2026-01-29 |
| Non-orchestrator sub-agents skip to depth 2 | Depth 1 reserved for orchestrator only | 2026-01-29 |
| Keep config paths as `opencode.json` | Upstream compatibility | 2026-01-28 |
| Use Git Bash env syntax | Terminal runs bash, not PowerShell | 2026-01-29 |

---

## Build Commands

```bash
cd packages/opencode

# Run tests
bun test

# Typecheck
bun run typecheck

# Build with version
OPENCODE_VERSION=0.0.2 bun run build --single

# Output: dist/@opencodeorchestra/cli-windows-x64/bin/OcOrchestra.exe
```

---

## Pending Work

1. **Navigation Feature** - Ctrl+X up/down for depth traversal (not yet implemented)
2. **Manual Integration Test** - Verify PM -> Orchestrator -> Subagent flow
3. **DCP Verification** - Confirm "hiding parentID for DCP" at Depth 0/1
4. **README Update** - Remove upstream OpenCode content, document OcO architecture

---

## Learnings

| Topic | Insight |
|-------|---------|
| Shell Environment | Windows terminal runs Git Bash, use bash syntax for env vars |
| Tool.define Wrapper | Adds `truncated: false` to all tool results at runtime |
| Test Assertions | Use `toMatchObject` for partial matching when runtime adds fields |
| Depth Calculation | Traverses session.parentID chain in task.ts |
| Agent singleShot | depth 2+ ALWAYS forces singleShot regardless of config |
