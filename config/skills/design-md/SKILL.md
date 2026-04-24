---
name: design-md
description: "Create, improve, review, and use DESIGN.md files: the Google Labs plain-text design-system convention for agents. Use when the user wants project visual design guidance, frontend design consistency, design tokens, brand/UI direction, design-system documentation, or says DESIGN.md/design.md. Also use before drafting or editing UI when a project design doc should guide colors, typography, spacing, motion, components, or visual tone."
---

# DESIGN.md

DESIGN.md is the design-system counterpart to AGENTS.md.

- `AGENTS.md` tells agents how to work in the repo.
- `DESIGN.md` tells agents how the product should look, feel, and behave visually.

Use this skill to create or improve durable visual design guidance that agents can reuse across frontend work. A good DESIGN.md reduces generic UI output, keeps screens consistent, and turns subjective taste into project context.

## When To Use

Use this skill when the task involves:

- creating, editing, reviewing, or explaining a `DESIGN.md` / `design.md` file;
- turning a product vibe, brand direction, screenshot, prototype, or existing UI into reusable design guidance;
- improving frontend design consistency across pages or components;
- documenting colors, typography, spacing, motion, shape, components, voice, or visual hierarchy;
- reviewing UI work against project design intent.

Do not force it for backend, provider, release, infrastructure, or test-maintenance work unless the user asks about user-facing behavior.

## Core Model

A DESIGN.md has two useful layers:

1. **Optional YAML front matter** for machine-readable design tokens.
2. **Markdown body** for human-readable rationale, usage guidance, examples, and do/don't rules.

Tokens are the stable values. Prose explains judgment. Prefer both when the project has enough design direction.

Read `references/spec-summary.md` before authoring a new file or making schema-sensitive edits. Read `references/template.md` when you need a starting structure.

## Workflow

### 1. Understand The Product

Gather design intent before writing. Useful sources:

- existing `DESIGN.md` / `design.md`;
- screenshots, app pages, Storybook, component libraries, CSS variables, Tailwind/theme config;
- README/product copy/brand notes;
- the user's taste words and explicit likes/dislikes.

If there is an existing DESIGN.md, preserve it. Improve targeted sections instead of rewriting the whole document unless the user asks for a reset.

### 2. Decide The Scope

Use one root DESIGN.md for project-wide visual identity. Use nested DESIGN.md files only when a sub-app/package has genuinely different visual rules.

Avoid cramming implementation details into the design doc. Put build commands in AGENTS.md and API details in normal docs.

### 3. Write Tokens When Values Are Known

Use YAML front matter for concrete, reusable values:

- color roles and semantic tokens;
- typography families, sizes, weights, line heights, letter spacing;
- spacing rhythm and layout scale;
- radii, elevation, shape, and motion tokens;
- component-level tokens when they are stable.

Do not invent fake precision. If the project only has a loose vibe, write prose first and leave tokens sparse or marked as proposed.

### 4. Write Prose For Judgment

The body should help future agents make taste decisions. Include:

- the product feel in concrete terms;
- how to apply colors and typography;
- layout and density expectations;
- component behavior and interaction tone;
- motion principles;
- examples of what to do and avoid.

Prefer specific guidance over style adjectives. "Use dense mission-control panels with clear hierarchy" beats "make it modern."

### 5. Preserve Custom Content

The Google Labs convention is intentionally extensible. When editing:

- preserve unknown tokens and custom front-matter fields;
- preserve unknown markdown sections;
- keep product-specific examples, exceptions, and rationale;
- call out intentional divergences instead of silently deleting them.

### 6. Validate When Available

If OCO's native `design` tool exists, use it for guidance/loading/validation:

- load existing project design context before design-facing work;
- use authoring guidance before creating a new DESIGN.md;
- validate after creating or editing DESIGN.md when compatible local tooling is available.

If validation is unavailable, continue best-effort and say that automated validation did not run.

## Quality Checklist

Before finishing a DESIGN.md task, check:

- The file separates agent operating rules from visual/product design intent.
- Tokens are concrete where values are known and not over-specified where they are not.
- The prose explains how to apply the visual system, not just what values exist.
- The document says what to avoid, not only what to prefer.
- Frontend agents can use it without asking the user to repeat the same taste guidance.
- Existing custom tokens/sections were preserved unless removal was requested.
- Validation was run or the reason it was skipped is clear.

## Output Style

When reporting to the user, summarize the design behavior in product language first. Mention file paths and validation only after explaining what the document now enables.

When creating a new DESIGN.md, offer one concise next step: use it on the next frontend task, refine it from screenshots, or add precise tokens from the codebase.

## Reference Files

- `references/spec-summary.md` - Condensed Google Labs DESIGN.md convention and schema guidance.
- `references/template.md` - Practical starting template for a new DESIGN.md.
