# Animation System — Consistent Motion Language for OpenCode WebUI

## Intent

Create a cohesive animation system inspired by Hyprland's approach: named bezier curves as shared tokens, categorized by interaction role, with per-surface duration tuning. The goal is to eliminate the jarring "teleport" feel of instant state changes and replace it with smooth, information-carrying motion that reduces cognitive load.

**Philosophy**: Motion should feel effortless and intentional. It communicates "what just happened" so the user's brain doesn't have to reconstruct it. Fast enough to never feel sluggish, present enough to always feel smooth.

## Context

### What Already Animates (Kobalte overlays)
- Dialogs: `contentShow`/`contentHide` keyframes (scale 0.98→1 + opacity), 150ms ease-out enter, 100ms ease-in exit
- Dropdown menus: opacity + scale via `[data-closed]`/`[data-expanded]` state attrs
- Popovers: same pattern as dropdowns
- Hover cards: same pattern
- Toasts: pop-in/pop-out keyframes + swipe gestures
- Mobile sidebar: `transition-transform duration-200 ease-out`

### What Has Animation Code But It's Commented Out
- **Collapsible** (`collapsible.css:53-57`): `slideDown`/`slideUp` keyframes exist at lines 89-105 but content animation rules are commented out
- **Tooltip** (`tooltip.css:30-73`): `transition: all 150ms ease-out` and per-placement `translate3d` transforms all commented out

### What Has No Animation At All
- Desktop sidebar expand/collapse (instant width change at `layout.tsx:1882`)
- Side panel open/close (`session-side-panel.tsx:82` — `<Show>` mount/unmount)
- Side panel tab switching (instant content swap)
- Route transitions (home → session, session → session)
- New messages appearing in timeline
- Tool card status changes (running → completed icon swap)
- Steps section expand/collapse (instant `<Show>`)
- Breadcrumb bar appearing
- Permission overlay badge appearing
- Subagent list items appearing/disappearing
- Context health indicator color changes
- Copy button feedback (icon swap, no transition)
- File tree expand/collapse (uses same commented-out Collapsible)

### Dependencies
- No animation library currently installed
- `solid-transition-group` needed for Part 2 (mount/unmount animations with SolidJS `<Show>`/`<For>`)

---

## Part 1: Foundation + Quick Wins

### Goal
Establish the motion token system and activate all existing-but-disabled animations. Add CSS transitions to panels and layout elements. No new dependencies required.

### 1A. Motion Token System

**New file**: `packages/ui/src/styles/motion.css`

Define CSS custom properties on `:root`:

```css
:root {
  /* === Easing Curves === */
  /* Enter: elements appearing — fast start, gentle landing (decelerate) */
  --motion-ease-enter: cubic-bezier(0.0, 0.0, 0.2, 1);
  /* Exit: elements leaving — quick departure (accelerate) */
  --motion-ease-exit: cubic-bezier(0.4, 0.0, 1, 1);
  /* Layout: elements moving/resizing — balanced standard curve */
  --motion-ease-layout: cubic-bezier(0.4, 0.0, 0.2, 1);
  /* Bounce: playful emphasis, slight Hyprland-style overshoot */
  --motion-ease-bounce: cubic-bezier(0.05, 0.9, 0.1, 1.05);
  /* Micro: snappy interactions — buttons, toggles, color changes */
  --motion-ease-micro: cubic-bezier(0.25, 0.1, 0.25, 1);

  /* === Duration Tiers === */
  /* Fast: micro-interactions, color/opacity changes, icon swaps */
  --motion-duration-fast: 120ms;
  /* Normal: panels, cards, collapsibles, most UI */
  --motion-duration-normal: 180ms;
  /* Slow: large layout shifts, route transitions, first-paint reveals */
  --motion-duration-slow: 280ms;

  /* === Prefers Reduced Motion === */
  /* All motion tokens collapse to instant when user prefers reduced motion */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 0ms;
    --motion-duration-normal: 0ms;
    --motion-duration-slow: 0ms;
  }
}
```

**Import**: Add `@import "./motion.css" layer(theme);` to `packages/ui/src/styles/index.css` after the theme imports (line 4).

### 1B. Uncomment Collapsible Animations

**File**: `packages/ui/src/components/collapsible.css`

Uncomment lines 53-57, replacing hardcoded values with motion tokens:

```css
[data-slot="collapsible-content"] {
  overflow: hidden;
  animation: slideUp var(--motion-duration-normal) var(--motion-ease-exit) forwards;

  &[data-expanded] {
    animation: slideDown var(--motion-duration-normal) var(--motion-ease-enter);
  }
}
```

This immediately animates: tool cards, file tree directories, accordion sections, steps sections.

### 1C. Uncomment Tooltip Animations

**File**: `packages/ui/src/components/tooltip.css`

Uncomment the transition and per-placement transforms, using motion tokens:

```css
[data-component="tooltip"] {
  /* ... existing styles ... */
  transition: opacity var(--motion-duration-fast) var(--motion-ease-enter),
              transform var(--motion-duration-fast) var(--motion-ease-enter);
  transform: translate3d(0, 0, 0);
  transform-origin: var(--kb-tooltip-content-transform-origin);

  &[data-expanded] {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }

  &[data-closed]:not([data-force-open="true"]) {
    opacity: 0;
  }

  &[data-placement="top"][data-closed] { transform: translate3d(0, 4px, 0); }
  &[data-placement="bottom"][data-closed] { transform: translate3d(0, -4px, 0); }
  &[data-placement="left"][data-closed] { transform: translate3d(4px, 0, 0); }
  &[data-placement="right"][data-closed] { transform: translate3d(-4px, 0, 0); }
}
```

### 1D. Migrate Existing Animations to Motion Tokens

Update existing animated components to use the shared tokens for consistency:

- **dialog.css**: `contentShow` → `var(--motion-duration-normal) var(--motion-ease-bounce)`, `contentHide` → `var(--motion-duration-fast) var(--motion-ease-exit)`
- **dropdown-menu.css**: transition timing → `var(--motion-duration-fast) var(--motion-ease-enter)` / exit variant
- **popover.css**: same pattern
- **hover-card.css**: same pattern
- **toast.css**: pop-in → `var(--motion-duration-normal) var(--motion-ease-bounce)`, pop-out → `var(--motion-duration-fast) var(--motion-ease-exit)`
- **animations.css**: `fadeUp` → use `var(--motion-duration-slow) var(--motion-ease-enter)`

### 1E. Desktop Sidebar Width Transition

**File**: `packages/app/src/pages/layout.tsx` (around line 1882)

Add CSS transition to the sidebar `<nav>` element's `style` or `classList`:

Add to the `<nav>` classList: a class with `transition-[width] duration-[--motion-duration-normal]` or add inline `transition: width var(--motion-duration-normal) var(--motion-ease-layout)`.

The sidebar already has dynamic `style={{ width: ... }}`. Adding a CSS transition on `width` makes it animate between 64px ↔ expanded width.

### 1F. Side Panel Slide Transition

**File**: `packages/app/src/pages/session/session-side-panel.tsx`

The side panel (`<aside>`) currently uses `<Show when={props.open}>` for hard mount/unmount. Replace with always-mounted but CSS-transitioned:

- Keep the `<aside>` always in DOM when the session is active
- Use `width: 0` / `opacity: 0` / `overflow: hidden` when closed, actual width when open
- Add `transition: width var(--motion-duration-normal) var(--motion-ease-layout), opacity var(--motion-duration-fast) var(--motion-ease-enter)`
- The inner content can still use `<Show>` but the container slides

### 1G. Context Health + Tool Status Color Transitions

**File**: `packages/ui/src/components/context-health.tsx`
- Add `transition: background-color var(--motion-duration-fast) var(--motion-ease-micro), color var(--motion-duration-fast) var(--motion-ease-micro)` to the indicator dot and text.

**File**: `packages/ui/src/components/basic-tool.tsx` and `message-part.tsx`
- Tool status icon containers: add `transition: color var(--motion-duration-fast) var(--motion-ease-micro)` so running→completed color shifts smoothly.

### 1H. Copy Button Feedback

Where copy feedback swaps icon from `copy` → `check`, add a brief opacity crossfade rather than instant swap.

---

## Part 2: Content & Navigation Animations

### Goal
Add mount/unmount animations for dynamically appearing content. Requires `solid-transition-group` for SolidJS `<Show>`/`<For>` integration.

### 2A. Install solid-transition-group

```bash
bun add solid-transition-group --cwd packages/app
```

This provides `<Transition>` and `<TransitionGroup>` components that hook into SolidJS's `<Show>` and `<For>` lifecycle.

### 2B. Permission Overlay Badge Entrance

**File**: `packages/app/src/components/permission-overlay.tsx`

Wrap the badge `<Show>` with `<Transition>`:
- Enter: fade + scale from 0.9 → 1 using `--motion-ease-bounce` over `--motion-duration-normal`
- Exit: fade + scale to 0.95 using `--motion-ease-exit` over `--motion-duration-fast`

Also wrap the permission drawer/sheet with slide-in from right.

### 2C. Breadcrumb Bar Entrance

**File**: `packages/app/src/pages/session/session-breadcrumb.tsx`

Wrap with `<Transition>`:
- Enter: fade + translateY from -8px using `--motion-ease-enter` over `--motion-duration-normal`
- Exit: fade out using `--motion-ease-exit` over `--motion-duration-fast`

### 2D. Subagent List Item Enter/Exit

**File**: `packages/app/src/components/subagent-list.tsx`

Wrap the `<For>` list with `<TransitionGroup>`:
- Enter: fade + translateY from 8px, staggered by 50ms per item
- Exit: fade out
- Use `--motion-ease-enter` / `--motion-duration-normal`

### 2E. New Message Entrance

**File**: `packages/ui/src/components/session-turn.tsx`

When new assistant turns appear, apply a subtle entrance:
- Fade + translateY from 6px over `--motion-duration-normal` with `--motion-ease-enter`
- Only for NEW messages (not historical ones on page load — check if session is actively streaming)

### 2F. Sidebar Flyout Panel

**File**: `packages/app/src/pages/layout.tsx` (around line 1928-1934)

The hover flyout panel (`<Show when={hoverProjectData()}>`) currently appears instantly. Wrap with `<Transition>`:
- Enter: fade + translateX from -8px using `--motion-ease-enter` over `--motion-duration-fast`
- Exit: fade using `--motion-ease-exit` over `--motion-duration-fast`

### 2G. Scroll-to-Bottom Button

**File**: `packages/ui/src/hooks/create-auto-scroll.tsx` / the resume scroll button

Wrap with `<Transition>`:
- Enter: fade + translateY from 8px + slight scale using `--motion-ease-bounce`
- Exit: fade + translateY to 8px using `--motion-ease-exit`

---

## Acceptance Criteria

### Part 1
- [ ] `motion.css` exists with 5 easing curves + 3 duration tiers + reduced-motion override
- [ ] `motion.css` imported in `index.css` theme layer
- [ ] Collapsible slide animations active (tool cards, file tree, steps all animate open/close)
- [ ] Tooltip fade+translate animations active with placement-aware direction
- [ ] Existing overlays (dialog, dropdown, popover, hover-card, toast) use motion tokens
- [ ] Desktop sidebar width change is animated
- [ ] Side panel open/close slides smoothly instead of instant mount
- [ ] Context health dot color transitions smoothly
- [ ] Tool status color changes transition smoothly
- [ ] `prefers-reduced-motion` disables all animations
- [ ] `bun turbo typecheck` passes
- [ ] `bun run --cwd packages/app build` succeeds

### Part 2
- [ ] `solid-transition-group` installed in packages/app
- [ ] Permission overlay badge enters with scale+fade, drawer slides in
- [ ] Breadcrumb bar fades in from above when it appears
- [ ] Subagent list items animate in with stagger
- [ ] New streaming messages have subtle entrance animation
- [ ] Sidebar flyout panel fades in
- [ ] Scroll-to-bottom button bounces in
- [ ] All new animations respect `prefers-reduced-motion`
- [ ] `bun turbo typecheck` passes
- [ ] `bun run --cwd packages/app build` succeeds

## Out of Scope
- Route-level page transitions (save for later — needs deeper router integration)
- Animation configuration UI / user-adjustable speeds
- Mobile-specific animation tuning (same system, same tokens)
- JavaScript animation library (GSAP, Motion, etc.) — CSS-first approach
- Tab content crossfade (side panel tab switching) — low impact, high complexity

## Risks
- SolidJS `<Show>` doesn't call exit animations on unmount without `solid-transition-group`'s `<Transition>` wrapper — Part 2 dependency
- Side panel always-mounted approach (1F) may need careful conditional rendering of heavy children to avoid performance cost when panel is "closed"
- Collapsible height animation uses `--kb-collapsible-content-height` CSS var from Kobalte — verify this is set correctly for dynamic content
