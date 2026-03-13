# Animation Performance — Safe Deferred-Mount Pass

## Intent

Keep the new motion system and smoother panel animations, but remove the laggy feel caused by heavy UI content mounting during the same animation window.

This pass is intentionally conservative:
- preserve current UX and state behavior
- keep existing visual animation language
- improve perceived smoothness by deferring heavy mounts until shells/panels are already opening
- avoid risky architectural changes like reworking session crossfade or terminal lifecycle persistence

## Context

The current animation polish succeeded visually, but some surfaces still feel heavy because expensive content renders immediately while layout animations are in progress.

### Confirmed hotspots

#### Right session side panel
- Outer shell animates in `packages/app/src/pages/session.tsx:1788` via `width: sessionPanelWidth()`
- Inner panel animates in `packages/app/src/pages/session/session-side-panel.tsx:113`
- Heavy content currently mounts inside the panel as soon as the open state flips:
  - `props.reviewPanel()` in `packages/app/src/pages/session/session-side-panel.tsx:145`
  - `SubagentList` in `packages/app/src/pages/session/session-side-panel.tsx:213`
  - `SessionContextTab` in `packages/app/src/pages/session/session-side-panel.tsx:223`
  - `FileTabContent` in `packages/app/src/pages/session/session-side-panel.tsx:238`
- `props.reviewPanel()` resolves to review content from `packages/app/src/pages/session.tsx:1184`-`1273`
- Review rendering is expensive because `packages/ui/src/components/session-review.tsx:343` iterates diffs and expanded diffs render dynamic diff bodies in `packages/ui/src/components/session-review.tsx:648`

#### Right panel file tree
- File tree pane mounts immediately in `packages/app/src/pages/session/session-side-panel.tsx:275`
- `FileTree` is recursive and runs eager list/expand effects in `packages/app/src/components/file-tree.tsx:362`-`540`

#### Terminal panel
- Panel shell animates in `packages/app/src/pages/session/terminal-panel.tsx:36` using `height` + `opacity`
- Body mounts immediately in `packages/app/src/pages/session/terminal-panel.tsx:52`
- Each terminal mounts Ghostty/websocket/addon setup in `packages/app/src/components/terminal.tsx:298`-`426`
- Inactive PTYs remain mounted and hidden in `packages/app/src/pages/session/terminal-panel.tsx:133`-`152`

#### Subagent list
- Fetch starts on mount in `packages/app/src/components/subagent-list.tsx:102`
- Each row derives sync/context state in `packages/app/src/components/subagent-list.tsx:191`-`205`
- Animation is already compositor-friendly; problem is early mount/fetch timing, not the animation itself

#### Timeline crossfade
- Crossfade duplicates timeline layers in `packages/app/src/pages/session/message-timeline.tsx:265`-`350`
- This is a real cost, but it is a separate, higher-risk optimization because it touches session navigation continuity

## Goals

1. Make the right panel open/close feel lighter and less janky
2. Make terminal open/close feel smoother by delaying expensive body mount
3. Reuse the same deferred-mount strategy for other heavy animated surfaces introduced in this round
4. Preserve scroll state, selected tabs, focused comments, terminal state, and current behavior wherever practical

## Changes Required

### 1. Add reusable deferred-visibility timing helper at component level

Do not create a global abstraction unless it clearly reduces duplication without obscuring behavior.

Simple local pattern is acceptable:
- visible shell state remains immediate for animation
- heavy content gets a second signal, e.g. `settledOpen` / `contentMounted`
- when panel opens:
  - if reduced motion, mount immediately
  - otherwise wait about `120-160ms` before mounting heavy body
- when panel closes:
  - unmount heavy content immediately or near-immediately unless doing so causes visual breakage

### 2. Right session side panel — defer heavy tab bodies until shell is opening

**File**: `packages/app/src/pages/session/session-side-panel.tsx`

Current state:
- shell animation exists
- inner content fade/slide exists
- expensive children still mount too early

Required behavior:
- keep the shell animation
- keep the current inner content reveal
- introduce a dedicated mount gate for heavy content, separate from the shell and separate from mere visual opacity

Suggested signals:
- `panelContentVisible` can continue to control visual reveal
- add a second signal like `panelContentMounted`

Open behavior:
- when `props.open` becomes true:
  - shell opens immediately
  - heavy content remains unmounted briefly
  - after ~140ms, mount active content
  - then let existing reveal styles show it

Close behavior:
- when `props.open` becomes false:
  - unmount heavy content immediately
  - hide visual wrapper immediately

Apply the mount gate to the heavy bodies, not to the entire shell:
- review body paths (`props.reviewPanel()`)
- `SubagentList`
- `SessionContextTab`
- `FileTabContent`

Do not regress:
- right-panel tab labels and badges should still appear with the shell
- open/close button behavior must remain instant and reliable
- active tab selection must be preserved

### 3. Right panel file tree — defer mounting until panel settles

**File**: `packages/app/src/pages/session/session-side-panel.tsx`

Current state:
- file tree side mounts as soon as `props.layout.fileTree.opened()` is true
- this triggers recursive tree rendering and tree list effects immediately

Required behavior:
- add a mount gate similar to the right-panel content gate
- the file-tree shell can open with the panel animation
- the heavy tree body should mount after the shell settles

Apply the gate to:
- `FileTree` in the `changes` tab
- `FileTree` in the `all` tab

If there is a lightweight loading or empty wrapper already present, it may remain visible before the tree mounts.

### 4. Terminal panel — defer expensive terminal body mount

**File**: `packages/app/src/pages/session/terminal-panel.tsx`

Current state:
- shell now animates better
- expensive terminal body still mounts as soon as `props.open` becomes true

Required behavior:
- preserve the shell height/opacity animation
- add a delayed body mount signal, e.g. `bodyMounted`
- when opening:
  - animate shell immediately
  - wait ~120-160ms
  - mount the terminal tab area
- when closing:
  - unmount body immediately or near-immediately

Keep current PTY behavior for now:
- do not yet change inactive PTY lifetime semantics
- do not risk terminal buffer/state loss in this pass

### 5. Subagent list — avoid eager fetch before the panel is settled

**Files**:
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/components/subagent-list.tsx`

Required behavior:
- because `SubagentList` should mount later, its existing `onMount` fetch timing will naturally move later
- no extra subagent-list refactor is required unless needed for correctness
- preserve SSE live updates once mounted

### 6. Do not optimize crossfade in this pass

**File**: `packages/app/src/pages/session/message-timeline.tsx`

Leave session-to-session crossfade as-is.

Rationale:
- it duplicates rendered turns during overlap
- but it is functioning correctly
- changing it now is medium-risk and could regress navigation continuity, scroll perception, or session switching correctness

## Acceptance Criteria

- Right panel open feels smoother because heavy tab bodies mount after the shell starts opening
- Right-side file tree no longer mounts immediately on panel open
- Terminal shell opens first, then terminal body mounts shortly after
- Subagent list fetch/render begins only after its panel/tab is actually settled open
- No regressions in selected tabs, review scroll behavior, focused comment behavior, or terminal open/close behavior
- `bun turbo typecheck` passes
- `bun run --cwd packages/app build` succeeds

## Verification Steps

1. Open the right panel from the top-right toggle and confirm the shell opens first, then content appears smoothly
2. Switch to `Subagents` and confirm the list appears smoothly without a heavy hitch on first open
3. Switch to review/file tabs and confirm the panel feels lighter than before
4. Open the terminal and confirm shell-first, content-second behavior still feels smooth
5. Confirm no obvious state loss when reopening the right panel during the same session

## Out of Scope

- Reworking session-to-session timeline crossfade
- Changing inactive terminal tabs from hidden-mounted to selectively mounted
- Changing review default-open diff behavior
- Replacing width/height animations with transform-driven layout illusions
- Route-level performance optimization

## Risks

- Over-aggressive unmounting could discard expensive but user-meaningful state; avoid unmounting shells or view-model state containers unnecessarily
- Delays that are too long will feel disconnected; keep them short and tied to existing motion durations
- File tree and review content must not flash blank during ordinary tab switches after the panel is already open
