# DESIGN.md Spec Summary

This is a practical summary of the Google Labs `DESIGN.md` convention. The upstream format is alpha, so preserve flexibility and avoid overfitting to one exact linter version.

## Purpose

DESIGN.md is a self-contained, plain-text representation of a design system. It is meant for both humans and agents.

Use it to capture how a product should look and feel: tokens, rationale, component rules, visual hierarchy, motion principles, and do/don't guidance.

## File Shape

A DESIGN.md file may contain:

1. **YAML front matter**: optional machine-readable tokens.
2. **Markdown body**: human-readable rationale and application guidance.

The token layer is normative when present. The prose explains how to apply the tokens.

## Common Front-Matter Fields

Use only what the project can support with real intent.

```yaml
---
version: alpha
name: Product Design System
description: Short description of the visual system.
colors:
  primary: "#123456"
  surface: "#f7f5f0"
  on-surface: "#16181d"
typography:
  heading:
    fontFamily: "Example Sans"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
spacing:
  md: 16px
rounded:
  card: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.card}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.card}"
---
```

Common token areas:

- `colors`
- `typography`
- `spacing`
- `rounded`
- `components`
- project-specific custom groups, such as `motion`, `elevation`, or `layout`

Token values can include dimensions such as `px`, `em`, or `rem`, hex colors, strings, numbers, and token references like `{colors.primary}`.

## Common Markdown Sections

Use sections that fit the project. A typical order:

1. `Overview`
2. `Colors`
3. `Typography`
4. `Layout`
5. `Elevation & Depth`
6. `Shapes`
7. `Motion`
8. `Components`
9. `Do's and Don'ts`

Unknown sections are allowed and should be preserved. Duplicate recognized sections may indicate a quality issue.

## Authoring Principles

- Write for future agents, not only humans.
- Use exact values when the project has exact values.
- Use concrete visual language when values are still exploratory.
- Explain why the design system exists and what tradeoffs it makes.
- Include anti-patterns; agents benefit from knowing what not to do.
- Keep implementation commands and repo workflow rules in AGENTS.md, not DESIGN.md.

## Editing Principles

- Preserve unknown tokens and custom front-matter fields.
- Preserve unknown markdown sections.
- Prefer targeted edits over full rewrites.
- Keep examples and exceptions when they encode product taste.
- If user instructions intentionally diverge from DESIGN.md, make the divergence explicit.

## Validation

The Google Labs CLI is published as `@google/design.md` and exposes a `design.md` binary. Typical commands include:

```bash
npx @google/design.md lint DESIGN.md
npx @google/design.md spec
npx @google/design.md spec --rules
```

In OCO, prefer the native `design` tool when available because it handles project scoping and graceful fallback. If validation tooling is missing, continue best-effort and report that automated validation was not run.
