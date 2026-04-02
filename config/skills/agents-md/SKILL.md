---
name: agents-md
description: Generates and improves AGENTS.md files for software projects. Analyzes codebases to produce agent-optimized instructions covering setup, build commands, testing, code style, architecture, PR guidelines, and project-specific conventions. Use when the user wants to create an AGENTS.md, improve existing agent instructions, set up a repo for AI coding agents, or mentions AGENTS.md, coding agent guidelines, agent rules, or project instructions for Codex, Copilot, Cursor, Jules, Devin, or similar tools.
---

# AGENTS.md Generator

AGENTS.md is a standard Markdown file that gives AI coding agents project-specific context: exact commands, enforced conventions, architecture constraints. Agents from most major tools (Codex, Copilot, Cursor, Jules, Devin, opencode, etc.) read it automatically.

## The Cost Model — Why Every Line Matters

**AGENTS.md is auto-injected into the agent's context window on every interaction.** Unlike docs or skills that load on demand, AGENTS.md permanently occupies context for every task the agent works on in that repo. A bloated AGENTS.md directly degrades agent performance on everything — less room for code, conversation, and reasoning.

This means:

**Prioritize by frequency × impact.** Every line must earn its permanent context cost.

| Priority | Content type | Why it earns its tokens |
|---|---|---|
| **Critical** | Test commands (run-all, run-single) | Used on nearly every task |
| **Critical** | Lint/format commands | Run after every edit |
| **Critical** | Architecture boundaries | Prevents expensive mistakes on every change |
| **High** | Code style rules (only enforced, non-obvious ones) | Prevents failed CI on every PR |
| **High** | Build commands | Used frequently |
| **Medium** | Commit/PR conventions | Used at end of each task |
| **Medium** | Setup instructions | Used once per session |
| **Low** | Deployment steps, migration workflows, API docs | Used rarely — consider putting in docs/ or a separate skill instead |

**What does NOT belong in AGENTS.md:**
- Detailed API reference docs → put in `docs/api.md`, the agent reads them when needed
- Extensive style guides → link to the config file (`see .eslintrc.json`), state only the non-obvious rules
- Complex deployment runbooks → put in `docs/deploy.md` or a deployment skill
- One-time setup instructions that are already in README → don't duplicate
- Anything the agent already knows (language defaults, how common tools work)

**Target:** Most single-package projects should produce an AGENTS.md under 150 lines. Monorepo roots can be longer (up to ~250), but nested per-package files should be tight (50-100 lines each). If you're over these targets, you're probably including content that should live elsewhere.

## Workflow

### Phase 1: Investigate the Project

Before writing anything, understand the codebase. Use focused investigation — don't guess.

**Mandatory checks:**

1. **Language & framework** — `ls` the root, read `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `build.gradle`, `pom.xml`, or equivalent
2. **Build & dev commands** — Look for `Makefile`, `justfile`, `Taskfile`, CI configs (`.github/workflows/`, `.gitlab-ci.yml`), `scripts/` directory
3. **Test setup** — Find test runner config, test directories, example test commands
4. **Linting & formatting** — Check for `.eslintrc`, `ruff.toml`, `rustfmt.toml`, `.prettierrc`, `.editorconfig`, clippy config, etc.
5. **Project structure** — Identify key directories, monorepo layout if applicable
6. **Existing docs** — Read `README.md`, `CONTRIBUTING.md`, existing `AGENTS.md` if present
7. **Git conventions** — Check recent commit messages for patterns, look for commit hooks or conventional commits config

**Use `references/detection-patterns.md`** to map config files to exact tool invocations. Don't guess commands — the detection patterns file maps every common signal (lockfiles, config files, CI steps) to the precise commands.

**Extract commands from CI configs.** CI workflows (`.github/workflows/*.yml`, `.gitlab-ci.yml`) contain the exact commands the project uses. Read them and convert `--check` mode to `--fix` mode for the AGENTS.md (e.g., CI's `prettier --check .` becomes `prettier --write .`).

**For monorepos**, additionally:
- Identify package manager workspace config (`pnpm-workspace.yaml`, `Cargo.toml` workspace members, etc.)
- Note which packages have their own test/build commands
- Plan nested AGENTS.md files for subprojects

### Phase 2: Draft the AGENTS.md

Write in imperative, agent-directed prose. Every instruction should be actionable. See `references/examples.md` for full examples across Rust, Python, TypeScript, Go, and Java projects.

**Core principle: Be specific and actionable.** Don't say "run tests" — say `pnpm test --filter <package>`. Don't say "follow the style guide" — say "use single quotes, no semicolons, 2-space indent."

#### Sections to Include

Include all that apply. Skip what doesn't — a short, accurate file beats a long, padded one.

| Section | When to include | What makes it good |
|---|---|---|
| **Setup / Environment** | Always | Exact install commands, required tools with versions, minimum viable path |
| **Commands** | Always | Flat list: build, dev, lint, format, typecheck. Specify working directory if ambiguous |
| **Testing** | Always (if tests exist) | Most important section. Include: run-all, run-single-file, run-single-test, package-scoped (monorepo). Agents run these commands directly |
| **Code style** | When the project has enforced conventions | Name the linter/formatter, state specific rules agents get wrong (quote style, semicolons, import ordering). Don't restate language defaults |
| **Architecture** | Non-trivial projects | Directory map + **boundary constraints**. Not just "what lives where" but "what must not import what" |
| **Commits & PRs** | When project has conventions | Message format, PR title format, pre-commit checks. Include good/bad examples |
| **Boundaries** | When safety matters | What to never do, what to ask about first |

**Optional:** Database conventions, API patterns, deployment steps, security rules, debugging tips — include when the project has specific patterns an agent would otherwise get wrong.

#### How to Write Each Section Well

**Testing** — the section agents rely on most. Always include three levels: run everything, run one file, run one test. If the project uses a wrapper tool (`breeze`, `docker compose`, `tox`), say so — agents will try to call the runner directly otherwise.

**Code style** — only state what's project-specific or counter-intuitive. Don't explain that Python uses 4-space indent (it's the default). Do explain that this project uses `ruff` not `black`, or that `assert` is banned in production code.

**Architecture** — the hardest section to write well. Boundaries matter more than descriptions. To discover undocumented boundaries:
- Check import patterns: `grep -r "from src.api import" src/core/` — if zero results, that's a boundary
- Check CI for architecture tests (e.g., `dependency-cruiser`, `cargo deny`, import linting rules)
- Look at module-level `__init__.py` or `mod.rs` for public API surface
- Ask: "if an agent added an import from module X to module Y, would that break the design?"

**Conventions** — distinguish enforced vs. aspirational. If CI runs `ruff check` on every PR, that convention is enforced — state it confidently. If CONTRIBUTING.md says "prefer functional style" but nothing checks it, state it as a preference, not a rule.

### Phase 3: Validate Commands

Before presenting the draft, verify that the commands actually work. This catches stale instructions, wrong flags, and missing setup steps.

**For each command in the AGENTS.md:**
1. Try running it (or a dry-run equivalent) in the project directory
2. If it fails, investigate why — wrong tool version? Missing dependency? Wrong working directory?
3. Fix the command or add a prerequisite note

**Validation priority** (do the most important first):
- Test commands (agents run these most often)
- Lint/format commands
- Build commands
- Setup commands (these often just work)

If you can't run a command (e.g., requires a database or Docker), note it with a comment explaining the dependency: `# Requires PostgreSQL running on localhost:5432`.

Skip validation for commands that are clearly correct from the config (e.g., the test script is literally `"test": "vitest run"` in package.json).

### Phase 4: Review & Refine

After validating, check the file against these criteria:

1. **Every command is copy-pasteable.** No placeholders unless explicitly labeled (like `<package-name>`).
2. **No obvious gaps.** If the project has tests, there's a testing section. If it has a linter, there's a lint command.
3. **No fluff.** Remove anything an agent already knows (what TypeScript is, how `npm install` works). Only project-specific context.
4. **Architecture boundaries are explicit.** If modules have import restrictions, say so.
5. **For monorepos: consider nested files.** If subprojects have their own build/test/lint commands, generate per-package AGENTS.md files. The closest AGENTS.md to the edited file takes precedence.

### Phase 5: Improving an Existing AGENTS.md

When improving rather than creating from scratch:

1. **Read the existing file first.** Understand what's already there before changing anything.
2. **Run the investigation phase anyway.** The existing AGENTS.md may be stale — compare what it says against actual config files, CI configs, and project structure.
3. **Check for staleness.** Look for:
   - Commands that reference tools or scripts that no longer exist
   - Outdated version numbers or deprecated flags
   - Missing sections for tools the project has adopted since the file was written
   - Architecture descriptions that don't match current directory structure
4. **Preserve what works.** Don't rewrite sections that are already good. Focus on gaps and inaccuracies.
5. **Validate changed commands.** Run any command you modify or add to confirm it works.
6. **Diff-friendly edits.** Make targeted changes rather than rewriting the whole file. The user can review a focused diff much faster.

### Phase 6: Nested AGENTS.md for Monorepos

Nested files matter for context efficiency — agents load the nearest AGENTS.md to the file being edited. In a monorepo with 10 packages, a single root file forces every agent interaction to load instructions for all 10 packages. Nested files scope the context to what's relevant.

```
monorepo/
├── AGENTS.md              # Root: workspace-level commands, shared conventions (~100 lines)
├── packages/
│   ├── api/
│   │   └── AGENTS.md      # API-specific: test commands, API conventions (~60 lines)
│   ├── web/
│   │   └── AGENTS.md      # Frontend-specific: dev server, component patterns (~60 lines)
│   └── shared/
│       └── AGENTS.md      # Shared library: build, usage from other packages (~40 lines)
```

**Root** — workspace-level commands, shared code style, cross-package rules. Keep it to what applies everywhere.

**Package** — package-specific build/test/lint, conventions unique to this package. Agent editing `packages/web/` gets root + web, not instructions for api or shared.

## Writing Quality Checklist

- [ ] Commands are exact, not vague ("run tests" → `pytest tests/ -xvs`)
- [ ] Commands were validated (or clearly correct from config)
- [ ] Working directories specified where ambiguous
- [ ] Linter and formatter named with their config
- [ ] Test runner named with example single-test invocation
- [ ] Architecture boundaries stated as constraints, not just descriptions
- [ ] No explanations of general programming concepts
- [ ] No time-sensitive information (use "current method" / "legacy" sections)
- [ ] Consistent terminology throughout
- [ ] Under 150 lines for single-package projects, ~250 max for monorepo roots, 50-100 for nested files
- [ ] Nested files for monorepo subprojects when applicable
- [ ] Commands extracted from CI configs where available (converted from --check to --fix mode)

## Reference Files

- `references/detection-patterns.md` — Maps config files and project signals to exact tool invocations. Read during Phase 1 investigation.
- `references/examples.md` — Real-world AGENTS.md examples and patterns from notable open-source projects
