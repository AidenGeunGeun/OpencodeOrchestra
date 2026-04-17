# Unify `plan` Agent Permissions with `build`

## Problem

`build` and `plan` are both `mode: "primary"`, `native: true`, share `PROMPT_PM`, share color, share `singleShot: false`, and now share `displayName: "PM"`. The only remaining difference is their permission profiles:

- `build` has `plan_enter: "allow"`, `plan_exit` inherited as default
- `plan` has `plan_exit: "allow"`, restricted `edit` (plan-markdown files only), `external_directory` allowlist for plan dir

This divergence existed to support upstream OpenCode's plan mode concept — a read-only analysis mode that restricted file edits to plan documents only. OCO's Orchestra model reassigns that responsibility: implementation belongs to the Orchestrator, not to a plan-mode PM. The PM is conceptually singular. `plan` is `hidden: true` in the selector and never directly surfaced to the user.

Because the user never sees `plan` as a distinct agent and never explicitly invokes it, the divergent permissions create phantom behavioral differences: in a plan-mode session the PM silently loses the ability to edit arbitrary files, even though the UI still labels everything as "PM" via `displayName`. This is the opposite of user transparency.

## Intent

Make `plan` behaviorally indistinguishable from `build`. Copy `build`'s permission profile onto `plan` so the only remaining distinction is the identifier itself. The `plan_enter` / `plan_exit` toggles become no-ops in terms of behavior but remain wired so nothing breaks elsewhere in the codebase that expects them to exist.

This is a **behavior change** within a rarely-used mode. It consciously sacrifices plan mode's read-only guarantee in exchange for a truly unified PM persona.

## Scope

**In scope:**
- `packages/opencode/src/agent/agent.ts` lines 107-133 (the `plan` built-in definition) — replace the permission block with `build`'s permission block
- Any test file that asserts plan-specific permission restrictions (`edit: "deny"` on non-plan files, `external_directory` allowlist for plan dir)

**Out of scope:**
- Renaming or removing the `plan` agent identifier
- Changing `plan_enter` / `plan_exit` tool behavior
- Removing plan-mode UX (the toggle keybind, the TUI state transition)
- `hidden: true` stays — `plan` should still not appear in the selector dropdown
- Custom user-defined agents with `mode: "primary"` and different permissions are unaffected

## Context

Current `plan` permission block at `agent.ts:111-126`:

```
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    question: "allow",
    plan_exit: "allow",
    external_directory: {
      [path.join(Global.Path.data, "plans", "*").replaceAll("\\", "/")]: "allow",
    },
    edit: {
      "*": "deny",
      [path.join(Global.Namespace.projectDir, "plans", "*.md").replaceAll("\\", "/")]: "allow",
      [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md"))).replaceAll("\\", "/")]: "allow",
    },
  }),
  user,
),
```

Current `build` permission block at `agent.ts:93-100` (target state for `plan`):

```
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    question: "allow",
    plan_enter: "allow",
  }),
  user,
),
```

Note that `plan_enter` and `plan_exit` are asymmetric — `plan` should get `plan_exit: "allow"` so it can still exit plan mode when the mode toggles. The only change is dropping `edit` restrictions and `external_directory` allowlist so `plan` can edit any file `build` can edit.

Proposed `plan` permission block:

```
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    question: "allow",
    plan_exit: "allow",
  }),
  user,
),
```

Keep `plan_exit: "allow"` instead of `plan_enter: "allow"` so plan mode can still exit cleanly. Everything else matches `build`.

## Acceptance Criteria

- `plan` agent's permission block matches `build`'s profile except for `plan_exit` instead of `plan_enter`
- `plan_exit: "allow"` preserved on `plan` so plan mode can exit
- Plan mode can still be entered and exited via the existing toggles (no breakage to UX flow)
- In plan mode, the PM can edit any file it could edit in regular mode — not just plan markdown
- `hidden: true` stays on `plan`
- `displayName: "PM"` stays on both `build` and `plan`
- Any test that asserts plan-specific edit restrictions is updated or removed with a clear comment explaining the unification

## Verification

1. `bun run --cwd packages/opencode typecheck` green
2. `bun turbo test` green. Any test asserting plan's restricted permissions must be updated to reflect the new unified behavior or removed with explanatory comment
3. Grep check: search for `plan.*edit.*deny` or `plan.*plans.*md.*allow` patterns — should only appear in historical doc/spec references, not runtime test assertions
4. Local TUI binary rebuild and install per previous patches
5. Local Desktop Dev app rebuild and install to `/Applications/OpenCodeOrchestra Dev.app`
6. Manual check (handed to PM):
   - Enter plan mode in a test session, edit an arbitrary file outside `plans/`. Should succeed without permission prompt
   - Exit plan mode. Should return to regular PM state
   - Selector still shows "PM" throughout

## Completion Standard

- Single-file source change in `agent.ts`
- Any broken tests updated or removed with explanatory comments
- Typecheck + tests green
- Local binary + Dev app installed for user visual check
- Hand back to PM. Do NOT trigger `bun run release`

## Release Notes

**Bundled into the same `1.1.4` release as `agent-display-name.md` and `tui-selector-alias-removal.md`.** These three changes form a coherent user story: remove the old alias hack, add a proper displayName abstraction, and make the hidden `plan` agent actually indistinguishable from `build` so the "PM" label is truthful.

Per root `AGENTS.md` release matrix, this is a behavior change in a rarely-used mode. Validation is on Dev desktop app first per the "high-risk, breaking, or architectural" guidance, since it affects agent permission semantics. After Dev validation and user approval, bundled release proceeds.
