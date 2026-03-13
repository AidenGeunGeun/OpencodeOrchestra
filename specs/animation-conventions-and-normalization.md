# Animation Conventions and Normalization

## Intent

Document a clear frontend motion convention in the repository docs, then bring the current implementation back into alignment where recent animation work drifted into ad hoc patterns.

The immediate goal is consistency, not a redesign:
- motion rules should be easy for future agents to follow
- reusable motion classes/tokens should be the default path
- app-level components should stop hand-writing repeated transition strings where a shared convention exists
- the currently roughest motion surfaces should become more uniform without regressing the smoother overlay work already shipped

## Context

Recent animation work introduced a solid foundation, but the implementation is now split across three styles:

1. **Shared motion tokens** in `packages/ui/src/styles/motion.css`
2. **Reusable transition classes** in `packages/ui/src/styles/motion-transitions.css`
3. **Inline per-component transition strings** in app components

The shared system is real, but it is not yet the authoritative convention.

### Current drift points

- `packages/app/src/pages/session/session-side-panel.tsx`
  - shell and content reveal both use inline `style={{ transition: ... }}` strings
  - motion is transform/opacity based, which is good, but the implementation is bespoke
- `packages/app/src/pages/session/terminal-panel.tsx`
  - shell uses inline height/opacity transitions and deferred mounting
  - this is acceptable as a pragmatic exception for measured height animation, but it is undocumented and therefore looks like a convention violation
- `packages/app/src/pages/layout/sidebar-shell.tsx`
  - left sidebar flyout still uses inline transition strings
- `packages/app/src/pages/layout.tsx`
  - sidebar width and a few opacity/transform transitions are still written inline
- `packages/app/src/pages/session/message-timeline.tsx`
  - session navigation uses shared motion classes, but transition timing is partly coupled to JS timeout logic via `getMotionDuration(...)`
  - the direction logic now works, but this file is still a high-risk motion surface and should be explicitly covered by the convention
- `packages/ui/AGENTS.md`
  - currently says `Do not use inline style attributes on components`
  - that is too absolute for current reality because app/session motion and measured shells sometimes need inline style for dynamic width/height/transform/opacity
- `packages/app/AGENTS.md`
  - currently says `Prefer Tailwind utility classes; avoid inline style attributes`
  - also too vague for the current motion system

## Goal

Establish an explicit motion convention with narrow, well-defined exceptions, and normalize the most obvious violations so the codebase has one preferred way to animate UI.

## Non-Goals

- Do not redesign the visual language again
- Do not replace the current motion token names
- Do not rewrite every animation in the app in one pass
- Do not remove the desktop right-panel overlay behavior
- Do not attempt risky performance rewrites of timeline rendering in this pass

## Changes Required

### 1. Add repo-level motion guidance to AGENTS docs

**Files**:
- `AGENTS.md`
- `packages/app/AGENTS.md`
- `packages/ui/AGENTS.md`

Required documentation changes:

- In root `AGENTS.md`, add a short **Frontend Motion** section that explains the house rules:
  - use shared motion tokens from `packages/ui/src/styles/motion.css`
  - use reusable motion utility classes from `packages/ui/src/styles/motion-transitions.css` for standard enter/exit patterns
  - prefer `transform` + `opacity` for visible motion
  - avoid animating layout properties (`width`, `height`, `top`, `left`, etc.) unless the interaction truly requires measured layout animation
  - respect `prefers-reduced-motion`
  - keep JS timers aligned with CSS token durations when overlap/unmount timing is required

- In `packages/app/AGENTS.md`, refine the existing Solid/frontend conventions so they no longer conflict with current motion work:
  - replace the blanket “avoid inline style attributes” guidance with a more precise rule
  - allow inline style only when values are dynamic/runtime-measured (for example: overlay width, terminal height, motion state driven by runtime dimensions)
  - for static animations, require shared motion classes or CSS classes instead of repeated inline transition strings

- In `packages/ui/AGENTS.md`, refine the CSS/component convention:
  - clarify that UI package components should still avoid inline style attributes in normal cases
  - explicitly allow motion utility classes in the `utilities` layer
  - document that new reusable motion patterns belong in `src/styles/motion-transitions.css`, not scattered per feature
  - document when a measured-motion exception is acceptable

### 2. Normalize repeated inline transition strings into shared motion utilities

**Primary files**:
- `packages/ui/src/styles/motion-transitions.css`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/layout/sidebar-shell.tsx`
- `packages/app/src/pages/layout.tsx`

Required behavior:

- Extend `motion-transitions.css` with a small set of reusable class families for common app-level motion that is currently duplicated inline.
- Prefer composable semantic utilities rather than one-off component-specific names.

Recommended class families:
- right/left/up fade-slide shell states
- enter/exit timing variants that map to the existing tokens
- optional utility for opacity-only fades when transform is not needed

Implementation guidance:
- Move duplicated `opacity ... transform ...` transition definitions out of app components where the motion is standard and not runtime-measured.
- Keep runtime dimensions inline if necessary, but the easing/duration/transition pattern itself should come from shared classes.

Acceptance note:
- after this pass, the right panel content reveal and left sidebar flyout should no longer hardcode long duplicated transition strings inline unless runtime measurement truly requires it.

### 3. Document and preserve measured-motion exceptions

**Primary files**:
- `packages/app/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/app/src/pages/session/terminal-panel.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`

Required behavior:

- Preserve measured inline styles where they are functionally necessary:
  - terminal shell height animation in `terminal-panel.tsx`
  - desktop right-panel width sizing in `session-side-panel.tsx`
  - any runtime-calculated width/height needed for resize handles or shell sizing
- But make these exceptions explicit in docs and keep their transition semantics aligned with shared tokens.

Implementation guidance:
- Do not try to force measured height/width animation into pure class-based CSS if the actual value is dynamic.
- If inline style remains, reduce it to dynamic values plus the minimum required transition hook, and avoid duplicating the same transition strings in many places.

### 4. Tighten directional session transition conventions without redesigning them

**Primary files**:
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/ui/src/styles/motion-transitions.css`
- possibly `packages/app/AGENTS.md`

Required behavior:

- Preserve the current depth-aware directional navigation (`deeper` / `shallower` / `lateral`).
- Normalize its timing constants to the shared motion vocabulary.
- Keep the current JS timeout logic only where needed for overlapping snapshot presence.
- Make the convention explicit: JS should coordinate *presence timing*, while CSS classes own the visible motion curve and duration.

This pass is not a new directional navigation redesign. It is a cleanup/consistency pass so the current implementation matches the documented rules.

### 5. Do a narrow normalization pass on current violations

Target only the clearest inconsistencies discovered in investigation:

- `packages/app/src/pages/session/session-side-panel.tsx`
  - normalize shell/content reveal motion against shared utilities where possible
- `packages/app/src/pages/layout/sidebar-shell.tsx`
  - normalize flyout motion against shared utilities
- `packages/app/src/pages/layout.tsx`
  - normalize easy inline opacity/transform transition fragments where no runtime measurement is needed
- `packages/app/src/pages/session/terminal-panel.tsx`
  - keep measured shell animation, but make it convention-compliant rather than ad hoc

Do not broaden this into a repo-wide cleanup beyond these files unless a nearby change is required for correctness.

## Acceptance Criteria

- Root, app, and ui `AGENTS.md` files explicitly document the motion convention and its exceptions
- The docs no longer contradict the current animation architecture
- Shared motion utilities in `packages/ui/src/styles/motion-transitions.css` cover the most repeated app-level enter/exit patterns
- Obvious duplicated inline transition strings are reduced in the targeted app files
- Measured-motion cases remain functional and documented as exceptions, not silent drift
- Directional session transition behavior is preserved
- Desktop right-panel overlay behavior is preserved
- `bun turbo typecheck` passes
- `bun run --cwd packages/app build` succeeds

## Verification Steps

1. Read the three AGENTS files and confirm they describe one coherent motion policy
2. Open/close the desktop right panel and confirm its smooth overlay behavior is unchanged
3. Open/close the terminal panel and confirm motion still works
4. Trigger left sidebar flyout and confirm it still animates correctly
5. Navigate deeper and shallower across session depth and confirm the directional transition still works
6. Confirm reduced-motion logic remains token-driven and unaffected

## Out of Scope

- New animation redesigns
- Motion changes for every component in `packages/ui`
- Timeline rendering performance rewrites
- Mobile layout redesign
- Theme/light-dark changes

## Risks

- Over-normalizing could accidentally break the right-panel overlay or terminal measured-height behavior
- Trying to remove all inline styles would conflict with runtime-sized interactions and create brittle CSS
- If utility classes are named too narrowly, the cleanup will produce another ad hoc layer instead of a real convention
