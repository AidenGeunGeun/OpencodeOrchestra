---
name: skill-creator
description: Create new skills, modify and improve existing skills, and test skill quality for OpenCodeOrchestra. Use when users want to create a skill from scratch, turn a workflow into a reusable skill, edit or optimize an existing skill, test a skill with realistic prompts, or improve a skill's description for better triggering accuracy. Also use when someone says "make this a skill", "save this as a skill", "create a skill for X", or asks about how OCO skills work.
---

# Skill Creator

A skill for creating, testing, and iterating on OCO skills.

## The Core Loop

1. Understand what the skill should do and when it should trigger
2. Write a draft SKILL.md
3. Test it with realistic prompts via subagents
4. Review the outputs with the user
5. Improve the skill based on feedback
6. Repeat until the user is satisfied
7. Optimize the description for accurate triggering

Your job is to figure out where the user is in this process and help them move forward. Maybe they want to create something from scratch. Maybe they already have a draft. Maybe the current conversation itself *is* the workflow they want to capture. Be flexible.

---

## Phase 1: Capture Intent

Start by understanding what the user wants. The current conversation might already contain a workflow worth capturing — tools used, step sequences, corrections made, input/output formats observed. Extract what you can from context first, then fill gaps with the user.

**Classify the skill type early** — this affects everything downstream:
- **Procedural/knowledge skills** (code-review, agents-md, writing-style) — output is subjective, testing is light, focus on clear workflow and good heuristics
- **Verifiable-output skills** (file transforms, code generation, data pipelines) — output is objectively checkable, formal testing with assertions pays off

**Key questions to answer:**

1. What should this skill enable an agent to do?
2. When should it trigger? (what user phrases, task types, contexts)
3. What's the expected output format or behavior?
4. Are there edge cases, constraints, or domain-specific rules?

### Interview and Research

Proactively ask about edge cases, example inputs/outputs, success criteria, and dependencies. If the skill involves external tools or APIs, use the researcher subagent to gather documentation. Come prepared with context so you reduce the burden on the user.

Check existing skills for patterns:

```bash
ls ~/.config/oco/skills/
```

Read similar skills if they exist — they're useful references for conventions and structure.

---

## Phase 2: Write the SKILL.md

### Frontmatter

Every skill needs YAML frontmatter with `name` and `description` (required), plus optional fields:

```yaml
---
name: my-skill
description: What it does and when to trigger. Be specific and slightly pushy.
license: Apache-2.0
compatibility: Requires git and docker
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---
```

**Required fields:**

**`name`:**
- 1-64 characters, lowercase alphanumeric + hyphens only
- No leading/trailing hyphens, no consecutive hyphens
- Must match the directory name
- Prefer gerund form (`processing-pdfs`, `analyzing-data`) or noun phrases (`pdf-processing`)
- Avoid vague names like `helper`, `utils`, `tools`

**`description`:**
- Max 1024 characters. This is the primary triggering mechanism — agents decide whether to load the skill based on it
- **Write in third person.** The description is injected into the system prompt; inconsistent point-of-view causes discovery problems. Good: `"Processes Excel files and generates reports"`. Avoid: `"I can help you process Excel files"`
- Include both what the skill does AND specific contexts/phrases that should trigger it
- Be slightly "pushy" — agents tend to undertrigger, so cast a wider net
- Bad: `"Helps with PDFs."`
- Good: `"Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs. Use when working with PDF documents, when the user mentions PDFs, document extraction, form filling, or needs to combine files — even if they don't explicitly say 'PDF skill'."`

**Optional fields:**
- `license` — License name or reference to a bundled LICENSE file
- `compatibility` — Max 500 chars. Environment requirements (target product, system packages, network access)
- `metadata` — Arbitrary key-value map for author, version, or client-specific properties
- `allowed-tools` — Space-delimited list of pre-approved tools the skill may use (experimental)

### Skill Directory Structure

```
skill-name/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: executable code for deterministic tasks
├── references/           # Optional: docs loaded into context on demand
└── assets/               # Optional: templates, static resources
```

### Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (~100 tokens): `name` + `description` — always visible to agents
2. **SKILL.md body** (< 500 lines ideal): loaded when the skill triggers
3. **Bundled resources** (unlimited): loaded on demand via explicit references

Keep SKILL.md under 500 lines. If you're pushing that limit, move detailed reference material into `references/` with clear pointers about when the agent should consult them.

**Domain organization** — when a skill covers multiple variants or frameworks:

```
cloud-deploy/
├── SKILL.md (workflow + selection logic)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

The agent reads only the relevant reference file.

### Writing Patterns

**Be concise.** The context window is a public good — your skill shares it with conversation history, system prompts, and other skills. Only add context the model doesn't already have. Challenge each paragraph: "Does this justify its token cost?" Claude is smart; don't explain what PDFs are.

**Set appropriate degrees of freedom.** Match specificity to task fragility:
- **High freedom** (text guidance) when multiple approaches are valid
- **Medium freedom** (pseudocode/templates) when a preferred pattern exists
- **Low freedom** (exact scripts) when operations are fragile and consistency is critical

**Use imperative form** in instructions. "Run the build script" not "You should run the build script."

**Explain the why.** When you explain *why* something matters, the model can generalize beyond the specific examples. If you find yourself writing ALWAYS or NEVER in all caps, that's a yellow flag — try reframing with reasoning instead.

**Define output formats explicitly:**

```markdown
## Report structure
Use this template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Include examples:**

```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

**Generalize, don't overfit.** Skills run across many different prompts. Write instructions that capture the principle, not just the specific examples you're working with. Avoid fiddly, narrow corrections — instead, explain the underlying intent so the model can adapt.

### OCO-Specific Conventions

When writing skills for OCO, reference the tools agents actually have:

- **File operations**: `Read`, `Write`, `Edit`, `Glob`, `Grep`
- **Terminal**: `Bash` (with `workdir` parameter, not `cd`)
- **Subagents**: `Task` with types: `orchestrator`, `investigator`, `web-search`, `auditor`, `docs`
- **Skills**: `Skill` to load other skills by name
- **Web**: `WebFetch` for URL content
- **User input**: `Question` for interactive decisions

If the skill depends on external CLIs or MCP servers, note this in the `compatibility` frontmatter field.

---

## Phase 3: Test the Skill

After writing the draft, test it. But match the testing approach to the skill type — not every skill needs formal evaluation infrastructure.

### Choose Your Testing Depth

**Light testing** — for procedural/knowledge skills (e.g., agents-md, code-review, writing-style):
- Write 2-3 realistic prompts
- Spawn one subagent with the skill instructions to verify the output is reasonable
- Review with the user
- The output is often subjective — trust human judgment over formal assertions

**Full testing** — for skills that produce verifiable artifacts (e.g., file transforms, code generation, data pipelines):
- Write 2-3 realistic prompts with concrete expected outputs
- Run with-skill vs. without-skill (baseline) comparisons via parallel subagents
- Draft assertions and grade programmatically
- See `references/schemas.md` for workspace layout, assertion types, and grading schemas

### Running Tests

For each test case, spawn a subagent using the Task tool with the skill instructions in its prompt:

```
Execute this task. Follow the skill instructions below precisely.

## Skill Instructions
<paste the SKILL.md content here>

## Task
<the test prompt>

## Output
Save all outputs to: <workspace>/iteration-N/eval-<name>/with_skill/outputs/
```

For full testing, also run a baseline (no skill instructions for new skills, previous version for improvements). Launch both in parallel.

### Presenting Results

1. For each test case, show the prompt and summarize what the skill produced
2. For full testing: highlight with-skill vs. without-skill differences and assertion pass/fail
3. Ask for feedback: "How does this look? Anything you'd change?"

---

## Phase 4: Improve the Skill

This is the heart of the loop. You've tested, the user has reviewed, now make it better.

### How to Think About Improvements

1. **Generalize from feedback.** The user is iterating on a few examples because it's fast. But the skill will be used across many different prompts. Rather than overfitting to the test cases, understand the underlying principle behind each piece of feedback and encode that.

2. **Keep the prompt lean.** Read the subagent transcripts, not just the final outputs. If the skill is making the agent waste time on unproductive steps, trim those instructions. Instructions that don't pull their weight should go.

3. **Explain the why.** Transmit understanding, not just rules. A well-reasoned explanation outperforms a wall of MUST/NEVER directives.

4. **Look for repeated work.** If multiple test runs independently wrote similar helper scripts or took the same multi-step approach, that's a signal. Bundle the common pattern into `scripts/` and reference it from the skill.

5. **Draft, then revise.** Write your improvement, then look at it with fresh eyes. Get into the user's head — what do they actually need?

### The Iteration Loop

1. Apply improvements to the skill
2. Rerun all test cases into `iteration-<N+1>/`
3. Present the new results with comparison to the previous iteration
4. Wait for user feedback
5. Read feedback, improve, repeat

Keep going until:
- The user says they're happy
- Feedback is all positive
- You're not making meaningful progress

---

## Phase 5: Description Optimization

The description field is the primary mechanism that determines whether an agent loads a skill. After the skill content is solid, optimize the description for triggering accuracy.

### Generate Trigger Test Queries

Create ~10 test queries — a mix of should-trigger and should-not-trigger. These must be realistic and specific, like a real user would type. Not `"Format this data"` but `"ok so my boss just sent me this xlsx file and she wants me to add a column that shows the profit margin"`.

**Should-trigger (5-6):** Different phrasings of the same intent — formal, casual, indirect. Include cases where the user doesn't name the skill explicitly but clearly needs it.

**Should-not-trigger (4-5):** Near-misses that share keywords but need something different. Make them genuinely tricky, not obviously irrelevant.

### Review with User

Present the full set and let the user add, remove, or modify. Bad test queries lead to bad descriptions.

### Iterate on the Description

For each test query, ask yourself: "Would an agent reading this description decide to load the skill for this prompt?" Adjust the description to improve coverage of should-trigger cases without false-triggering on the should-not cases.

Test the updated description by loading the skill list and checking which queries would match:

```bash
# Quick check: does the description contain relevant keywords?
grep -i "keyword" ~/.config/oco/skills/<name>/SKILL.md
```

Present before/after descriptions to the user with your reasoning.

---

## Skill Installation

Once the skill is finalized, make sure it's properly installed:

```bash
# Verify the skill directory exists and is well-formed
ls ~/.config/oco/skills/<skill-name>/
cat ~/.config/oco/skills/<skill-name>/SKILL.md | head -10

# Verify the skill appears in available skills
# (the user can check this by starting a new conversation)
```

**OCO skill locations** (in priority order):
- Project-local: `.oco/skills/<name>/SKILL.md`
- Global: `~/.config/oco/skills/<name>/SKILL.md`
- Claude-compatible: `.claude/skills/<name>/SKILL.md`
- Agent-compatible: `.agents/skills/<name>/SKILL.md`

For skills meant to be used across all projects, install globally. For project-specific skills, use the project-local path.

---

## Updating an Existing Skill

If the user wants to improve an existing skill rather than create a new one:

1. **Preserve the original name.** Don't rename it.
2. **Snapshot before editing.** Copy the current version to the workspace so you can compare and revert.
3. **Follow the same test/improve loop** — the baseline is the old version of the skill, not "no skill."

---

## Anti-Patterns

Watch for these common mistakes when reviewing or writing skills:

- **Over-explaining basics** — Don't tell Claude what a PDF is or how imports work. Add only what it doesn't already know.
- **Too many options** — Don't present five libraries when one default with an escape hatch suffices.
- **Time-sensitive info** — Avoid "after August 2025, use the new API." Use a "current method" section and collapse legacy info.
- **Inconsistent terminology** — Pick one term and stick with it. Don't mix "endpoint", "URL", "route", and "path."
- **Windows-style paths** — Always use forward slashes (`scripts/helper.py`), even on Windows.
- **Deeply nested references** — Keep file references one level deep from SKILL.md. Avoid chains like SKILL.md → advanced.md → details.md.
- **Magic constants in scripts** — Document why a value is what it is. If you don't know the right value, Claude won't either.

---

## Quick Reference

| Step | What Happens |
|------|-------------|
| Capture intent | Understand the goal, interview the user, research |
| Write draft | SKILL.md with frontmatter, instructions, examples |
| Test | Spawn subagent runs with/without skill, collect outputs |
| Review | Present results, get user feedback |
| Improve | Generalize from feedback, trim waste, explain why |
| Optimize description | Trigger test queries, iterate on description |
| Install | Place in correct skill directory, verify loading |

## Reference Files

- `references/schemas.md` — JSON schemas for eval metadata, assertions, grading results, and workspace layout
