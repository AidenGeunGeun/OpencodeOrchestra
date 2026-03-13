# Directional Session Transitions

## Intent

Replace the current generic session crossfade with directional motion tied to session depth.

Desired behavior:
- navigating **down** into a deeper subagent session slides the new session in from the right and sends the old one left
- navigating **up** toward a parent session slides the new session in from the left and sends the old one right
- content should already be loading in the background so the animation hides latency as much as possible

## Context

- Existing transition logic lives in `packages/app/src/pages/session/message-timeline.tsx`
- It currently uses a generic `motion-crossfade` / `motion-crossfade-out` class pair from `packages/ui/src/styles/motion-transitions.css`
- Transition trigger is driven by `sessionID` change in `message-timeline.tsx:282`-`318`
- The session page already knows breadcrumb ancestry and current parent info in `packages/app/src/pages/session.tsx`

## Goal

Add directional session transitions based on depth change, without redesigning routing or session loading.

## Changes Required

### 1. Track navigation direction

**File**: `packages/app/src/pages/session.tsx`

Pass a new prop into `MessageTimeline`, something like:
- `navigationDirection: "deeper" | "shallower" | "lateral"`

Direction logic:
- if next session depth > previous depth => `deeper`
- if next session depth < previous depth => `shallower`
- otherwise => `lateral`

Use existing breadcrumb/session ancestry information already available in the page. Keep logic local and simple.

### 2. Replace generic crossfade with directional classes

**File**: `packages/app/src/pages/session/message-timeline.tsx`

Keep the existing snapshot-based transition structure, but add direction-aware classes for:
- leaving layer
- entering/live layer

Behavior:
- `deeper`
  - old content exits left
  - new content enters from right
- `shallower`
  - old content exits right
  - new content enters from left
- `lateral`
  - keep a softer fallback, likely existing crossfade behavior

Do not remove the leaving snapshot system.

### 3. Add motion classes

**File**: `packages/ui/src/styles/motion-transitions.css`

Add directional session transition utility classes, for example:
- `motion-session-enter-deeper`
- `motion-session-enter-shallower`
- `motion-session-exit-deeper`
- `motion-session-exit-shallower`

These should be transform/opacity-based, not width-based.

Suggested feel:
- offset around `18px` to `24px`
- enter uses `var(--motion-duration-normal)` + `var(--motion-ease-enter)`
- exit uses `var(--motion-duration-fast)` + `var(--motion-ease-exit)`

### 4. Preserve loading behavior

Do not add a new preload system in this pass.
Use the existing overlap model:
- previous snapshot remains on screen briefly
- new session content renders underneath / alongside it

That already gives us most of the perceived preload effect.

## Acceptance Criteria

- entering a deeper subagent session animates with directional motion
- returning upward animates in the opposite direction
- lateral transitions still look acceptable
- transitions remain smooth and transform/opacity-based
- `bun turbo typecheck` passes
- `bun run --cwd packages/app build` succeeds

## Out of Scope

- router-level preload changes
- timeline virtualization changes
- changing right-panel or terminal animations

## Risks

- incorrect depth comparison could invert direction
- transition state must not break scroll or snapshot cleanup
