# Right Panel Overlay Animation — Desktop Smoothness Pass

## Intent

Make the desktop right session panel (`Review` / `Subagents` / `Context` / file tabs) feel smooth in a Hyprland-like way by animating it as an overlay sheet instead of a live width-reflowing layout column.

The key outcome is:
- opening animation uses mostly `transform` + `opacity`
- closing animation is visible and smooth
- the main session column no longer reflows during the visible motion
- heavy right-panel content continues to mount after the shell begins opening

## Context

### Why the current version still feels heavy
- `packages/app/src/pages/session.tsx:240`-`243` computes `sessionPanelWidth()` for the main session column.
- `packages/app/src/pages/session.tsx:1789`-`1799` applies that width directly to the main session area and animates it with `transition: width ...`.
- `packages/app/src/pages/session/session-side-panel.tsx:153`-`171` animates the right panel itself with `max-width` / `width`.
- That means both the main content and the right panel are doing layout work while the animation runs.

This is the opposite of the feel we want. Hyprland-style smoothness comes from moving rendered layers, not constantly recomputing neighboring layout during the visible motion.

### Existing good work to preserve
- Inner right-panel heavy content is already deferred with local signals/timers in `packages/app/src/pages/session/session-side-panel.tsx:79`-`148`.
- Terminal is already improved and should be left alone in this pass.
- Right-panel tabs and badges currently remain visible immediately; preserve that behavior.

## Goal

On desktop, the right panel should behave like a docked overlay sheet:
- it visually slides over the right edge of the session area
- it does not push the session timeline during the visible animation
- once open, it remains fully interactive and sized correctly
- close animation is equally visible and smooth

## Non-Goals
- Do not redesign mobile behavior.
- Do not change terminal behavior in this pass.
- Do not change session-to-session crossfade.
- Do not change review diff rendering behavior.
- Do not create a global animation framework rewrite.

## Changes Required

### 1. Stop animating the desktop main session column width

**File**: `packages/app/src/pages/session.tsx`

Current behavior:
- main session column width changes via `sessionPanelWidth()` and transitions width.

Required behavior:
- on desktop, the main session column should remain full-width during right-panel open/close motion
- remove the visible width animation from the main session column for desktop
- preserve existing mobile behavior

Implementation guidance:
- Replace the width-driven desktop motion with a stable main content area.
- If a layout value is still needed for sizing logic, it must not create visible width animation during open/close.

Acceptance note:
- The timeline/prompt area should no longer visibly squeeze while the right panel opens.

### 2. Turn the desktop right panel into an absolutely positioned overlay sheet

**Files**:
- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`

Required behavior:
- On desktop only, render the right panel in an overlay layer anchored to the right side of the session area.
- The panel should be positioned absolutely within the session container, not as a normal flex child participating in layout width.
- The panel shell should animate with:
  - `transform: translateX(...)`
  - `opacity`
- Keep `overflow: hidden` / clipping as needed inside the panel, but do not drive the motion with `width` / `max-width`.

Recommended motion:
- open: `opacity: 0 -> 1`, `translateX(20px) -> 0`
- close: `opacity: 1 -> 0`, `translateX(0) -> 20px`
- use existing motion tokens:
  - enter: `var(--motion-duration-normal)` + `var(--motion-ease-enter)`
  - exit: `var(--motion-duration-fast)` + `var(--motion-ease-exit)`

Sizing:
- When `reviewOpen`, use `layout.session.width()` as the panel width.
- When only file tree is open, use `layout.fileTree.width()`.
- Width may still be applied as a static style for the opened sheet size, but width itself should not be the animated property.

### 3. Keep close animation visible

**File**: `packages/app/src/pages/session/session-side-panel.tsx`

Current issue:
- collapse feels instant because content visibility and shell participation disappear too early.

Required behavior:
- introduce separate shell presence state from open state if needed, e.g.:
  - `shellPresent`
  - `shellVisible`
- when opening:
  - panel becomes present immediately
  - next frame or immediate tick sets it visible
- when closing:
  - panel remains present while exit animation runs
  - after exit duration, unmount or fully hide it

This is required so close is no longer a snap.

### 4. Preserve deferred heavy-content mount strategy inside the sheet

**File**: `packages/app/src/pages/session/session-side-panel.tsx`

Required behavior:
- keep the existing delayed mounting of heavy content
- align it with overlay-sheet timing so shell motion starts first, heavy bodies appear second
- preserve immediate visibility for lightweight chrome (tab strip, counts, structural header areas)

### 5. Resize handle behavior

**Files**:
- `packages/app/src/pages/session.tsx`
- possibly `packages/app/src/pages/session/session-side-panel.tsx`

Current behavior:
- resize handle sits in the flex layout flow for the right panel

Required behavior:
- preserve resize capability for the desktop right panel
- ensure the resize handle remains visually and functionally attached to the overlay sheet
- it may need to become part of the overlay layer rather than a sibling in flex flow

### 6. Layering and interaction rules

Required behavior:
- the overlay sheet must sit above the main session content and prompt area without breaking interaction inside the sheet
- while closed, it must not intercept pointer events
- while open, it must fully intercept pointer events within the sheet bounds
- z-index should be high enough to avoid clipping issues with session content

### 7. Desktop-only

Required behavior:
- keep the existing mobile/session tab behavior untouched
- only change the desktop right-panel implementation path

## Acceptance Criteria

- Opening the desktop right panel no longer visibly squeezes the message timeline while animating
- The desktop right panel opens with transform/opacity-driven motion rather than width-driven visible reflow
- Closing the desktop right panel has a visible animation instead of snapping shut
- Existing heavy-content deferred-mount behavior still works inside the panel
- Resize handle still works on desktop
- Right-panel tab chrome remains immediately visible when appropriate
- `bun turbo typecheck` passes
- `bun run --cwd packages/app build` succeeds

## Verification Steps

1. Open the right panel from the top-right toggle and confirm the main timeline does not visibly compress during the motion
2. Close the right panel and confirm the shell visibly exits rather than snapping away
3. Switch to `Subagents` and confirm shell-first, content-second behavior remains intact
4. Open review/file states and confirm resize still works
5. Confirm mobile behavior is unchanged

## Out of Scope

- Backdrop/scrim behind the right panel
- Terminal changes
- Session crossfade performance work
- Review diff virtualization or other heavy rendering redesign

## Risks

- Overlay positioning may conflict with prompt dock or internal stacking if z-index is not chosen carefully
- Resize handle placement may need adjustment once the panel is removed from flex layout
- If shell presence state is mishandled, panel could flicker on rapid open/close toggles
