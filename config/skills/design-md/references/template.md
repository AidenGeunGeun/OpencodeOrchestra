# DESIGN.md Template

Use this as a starting point. Replace sample values with real project intent and delete sections that do not apply. The token example uses direct color tokens because that is what the current Google validator expects.

```markdown
---
version: alpha
name: Product Design System
description: One sentence describing the visual identity and product context.
colors:
  primary: "#1A1C1E"
  surface: "#F7F5F2"
  on-surface: "#1A1C1E"
typography:
  heading:
    fontFamily: "Public Sans"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Public Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  sm: 8px
  md: 16px
  lg: 24px
rounded:
  control: 10px
  card: 18px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: 12px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.card}"
    padding: 24px
---

# [Product Name] Design System

## Overview

[Describe the product feel in concrete terms. Name the emotional/functional target and the tradeoffs.]

## Colors

[Explain color roles, contrast expectations, background treatment, and what to avoid.]

## Typography

[Explain type personality, hierarchy, density, and text treatment.]

## Layout

[Explain grid, spacing rhythm, information density, breakpoints, and composition.]

## Elevation & Depth

[Explain shadows, borders, glass/blur, layering, and depth restraint.]

## Shapes

[Explain radius, geometry, icon shape language, and component silhouette.]

## Motion

[Explain which motion is meaningful, which motion is noise, and timing/transition principles.]

## Components

[Document key component behavior: buttons, cards, forms, navigation, dialogs, charts, or domain-specific surfaces.]

## Voice & Copy

[Describe user-facing tone if it affects interface design.]

## Do's and Don'ts

Do:
- [Specific desired pattern]
- [Specific desired pattern]

Don't:
- [Specific anti-pattern]
- [Specific anti-pattern]
```

## A Strong Overview Looks Like

Prefer:

> The interface should feel like calm mission-control software: dense but legible, precise without being sterile, and confident under pressure. Use restrained contrast, clear hierarchy, and purposeful motion. Avoid generic SaaS gradients, oversized empty cards, and decorative animation that does not clarify state.

Avoid:

> Make the app modern, clean, and beautiful.

## Minimal Version

When the project has no stable tokens yet, start with prose and a few proposed tokens:

```markdown
---
version: alpha
name: Project Design Direction
description: Early design guidance; tokens are provisional.
---

# Project Design Direction

## Overview

[Concrete visual direction.]

## Do's and Don'ts

Do:
- [Desired pattern]

Don't:
- [Anti-pattern]
```
