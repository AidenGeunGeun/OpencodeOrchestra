# Strip Desktop App and Upstream Web Infrastructure

## Intent

Remove all traces of the upstream OpenCode Desktop app (Tauri/sidecar) and upstream web/cloud infrastructure packages from the OpenCodeOrchestra repository. The result is a clean baseline containing only the core TUI, backend server, SDK, plugin API, and utilities.

## Context

OpenCodeOrchestra is a fork of upstream opencode v1.2.5 at version 1.0.7 (tag `oco-v1.0.7`). The upstream project ships a Tauri desktop app, shared web frontend, marketing website, docs site, and Cloudflare cloud infrastructure. None of this is needed for our fork. A previous attempt to build on the existing desktop infrastructure failed catastrophically and required a hard reset. This task ensures a permanently clean foundation for a future custom hub built from the ground up.

## Goals

1. Delete all 13 upstream packages not needed by the core
2. Clean all infrastructure, build config, CI, and docs of removed-package references
3. Ensure TUI + server builds, installs, and tests pass after cleanup

## Acceptance Criteria

- Only these 5 packages remain under `packages/`: `opencode`, `sdk`, `plugin`, `script`, `util`
- No file in the repo imports from or references deleted packages as dependencies
- No file references "tauri", "sidecar" (in desktop-app context), or desktop-app concepts
- `bun install` succeeds cleanly
- `bun run --cwd packages/opencode src/index.ts --help` runs without error
- Tests in `packages/opencode` pass (target: 884 pass / 0 fail, matching UPSTREAM-DIFF.md baseline)

---

## Changes Required

### Phase 1: Delete packages (13 directories)

Delete these entire directories under `packages/`:

```
packages/desktop/      # Tauri desktop app (primary target)
packages/app/          # Shared web/desktop frontend
packages/ui/           # UI component library
packages/console/      # Marketing/console website
packages/web/          # Docs website (Astro)
packages/docs/         # Mintlify docs
packages/enterprise/   # Enterprise share UI
packages/function/     # Cloudflare Workers API
packages/slack/        # Slack integration
packages/extensions/   # Zed extension
packages/hub/          # Empty placeholder (.code-intel only)
packages/Claude/       # Empty placeholder (.code-intel only)
packages/identity/     # Branding SVG assets
```

### Phase 2: Delete infrastructure files

- Delete `nix/desktop.nix`
- Delete `sst.config.ts` (SST cloud deployment config)
- Delete `sst-env.d.ts` (SST type declarations)
- Delete entire `infra/` directory (app.ts, console.ts, enterprise.ts, secret.ts, stage.ts)
- Delete `OpenCodeOrchestra-v0.4.0.zip` from repo root (stale release archive)
- Delete `nul` from repo root (Windows artifact)

### Phase 3: Clean `flake.nix`

Remove the desktop package and keep only devShells + opencode.

Current (lines 42-44, 65):
```nix
desktop = pkgs.callPackage ./nix/desktop.nix {
  inherit opencode;
};
...
inherit opencode desktop;
```

After:
```nix
# Remove the desktop lines entirely
# Change: inherit opencode desktop;
# To: inherit opencode;
```

### Phase 4: Clean root `package.json`

**Workspaces** - update to only include kept packages:
```json
"workspaces": {
  "packages": [
    "packages/*",
    "packages/sdk/js"
  ],
  ...
}
```
Remove `"packages/console/*"` and `"packages/slack"` from the packages array.

**Dependencies** - remove:
- `"@aws-sdk/client-s3"` from dependencies (only used by cloud infra)

**DevDependencies** - remove:
- `"sst"` from devDependencies (SST no longer needed)

**Catalog** - remove entries only used by deleted packages. The following catalog entries are used ONLY by deleted packages (app, ui, console, desktop, enterprise, web) and NOT by the 5 kept packages:
- `"@kobalte/core"` - UI component library dep
- `"@types/luxon"` - used by app
- `"@cloudflare/workers-types"` - used by function
- `"@openauthjs/openauth"` - used by console/function
- `"@pierre/diffs"` - used by app
- `"@solid-primitives/storage"` - used by app
- `"@tailwindcss/vite"` - used by app/console
- `"dompurify"` - used by app
- `"fuzzysort"` - used by app
- `"luxon"` - used by app
- `"marked"` - used by app
- `"marked-shiki"` - used by app
- `"@playwright/test"` - used by app e2e
- `"shiki"` - used by app
- `"solid-list"` - used by app
- `"tailwindcss"` - used by app/console/ui
- `"virtua"` - used by app
- `"vite"` - used by app/desktop
- `"@solidjs/meta"` - used by console/enterprise
- `"@solidjs/router"` - used by console/enterprise
- `"@solidjs/start"` - used by console/enterprise
- `"solid-js"` - used by app/ui/console/enterprise
- `"vite-plugin-solid"` - used by app

**IMPORTANT**: Before removing any catalog entry, the orchestrator MUST grep the 5 kept packages (`opencode`, `sdk/js`, `plugin`, `script`, `util`) to confirm the entry is not used there. If a catalog entry IS used by a kept package, do NOT remove it. This list is a starting recommendation, not a guarantee.

### Phase 5: Clean `turbo.json`

Remove the `@opencode-ai/app#test` task (line 13-16, package deleted):
```json
"@opencode-ai/app#test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

Keep `opencode#test` and `build` tasks.

### Phase 6: Clean CI (`.github/workflows/test.yml`)

The Windows matrix entry (lines 25-29) runs e2e tests in `packages/app` which is being deleted. Remove:
- The entire `windows` matrix entry (name: windows, host: windows-latest, workdir: packages/app, command: bun test:e2e:local)
- The Playwright install step (lines 43-45) that runs in `packages/app` — or change working-directory to `.` if Playwright is still needed by opencode tests
- The Playwright artifact upload paths referencing `packages/app/e2e/` (lines 137-139)
- Environment variables that reference VITE/PLAYWRIGHT server config only used by app e2e (lines 123-127)

If Playwright is NOT used by any remaining package tests, remove Playwright setup entirely.

After cleanup, the CI should run only the Linux job: typecheck + test for the core packages.

### Phase 7: Clean `CONTRIBUTING.md`

Remove or rewrite these sections:

**Lines 70-71** — Remove references to `packages/app` and `packages/desktop`:
```
  - `packages/app`: The shared web UI components, written in SolidJS
  - `packages/desktop`: The native desktop app, built with Tauri (wraps `packages/app`)
```

**Lines 106-117** — Remove "Running the Web App" section entirely (references `packages/app`).

**Lines 119-146** — Remove "Running the Desktop App" section entirely (references Tauri/desktop).

**Lines 232-234** — Remove desktop scope examples from PR titles:
```
- `feat(app):` feature in the app package
- `fix(desktop):` bug fix in the desktop package
```

### Phase 8: Clean translated READMEs

**README.zh-CN.md** (lines ~43-56): Remove desktop download section listing .dmg, .exe, .deb, .rpm, .AppImage URLs and package manager install commands for desktop.

**README.zh-TW.md** (lines ~43-56): Same removal.

**README.md**: Check for any desktop references and remove. The current README is OcO-specific and may not have desktop content, but verify.

### Phase 9: Clean remaining cross-references

Search ALL remaining files for these patterns and fix/remove:
- `@opencode-ai/app` (imports or references)
- `@opencode-ai/ui` (imports or references)
- `@opencode-ai/desktop` (imports or references)
- `@opencode-ai/enterprise` (imports or references)
- `@opencode-ai/function` (imports or references)
- `@opencode-ai/docs` (imports or references)
- `packages/desktop` (path references)
- `packages/app` (path references, NOT `packages/app` as substring of other valid paths)
- `packages/console` (path references)
- `packages/web` (path references)
- `tauri` (desktop-app context, NOT the word in general English if present)
- `sidecar` (desktop-app context — note: `packages/opencode` uses "sidecar" for JSON agentID storage, which is LEGITIMATE and must NOT be removed)
- `desktop` (app context — note: legitimate uses like "desktop environment" or terminal capabilities must NOT be removed)

Files to specifically check:
- `AGENTS.md` — may reference desktop/app packages
- `UPSTREAM-DIFF.md` — tracks file counts that will change
- `BACKLOG.md` — may reference desktop features
- `STATS.md` — may reference desktop metrics
- `.prettierignore` — may reference deleted paths
- `.gitignore` — may reference deleted paths
- `github/` directory (separate from `.github/`) — unknown purpose, check for desktop refs
- `themes/` directory — check for desktop theme references
- `patches/` directory — check if `ghostty-web@0.3.0.patch` is still needed (ghostty-web is used by opencode TUI, so likely yes)

### Phase 10: Regenerate lockfile and verify

1. Delete `bun.lock`
2. Run `bun install` — must succeed
3. Run `bun run --cwd packages/opencode src/index.ts --help` — must show CLI help
4. Run tests: from repo root, `bun turbo test` — opencode tests must pass
5. Verify no TypeScript errors: `bun turbo typecheck`

---

## Test Cases

1. `bun install` exits 0
2. `bun turbo typecheck` exits 0
3. `bun turbo test` — opencode tests pass (target: 884 pass / 0 fail)
4. `ls packages/` shows exactly: `opencode  plugin  script  sdk  util`
5. `grep -r "@opencode-ai/app" packages/ --include="*.ts" --include="*.tsx" --include="*.json"` returns no results
6. `grep -r "@opencode-ai/ui" packages/ --include="*.ts" --include="*.tsx" --include="*.json"` returns no results
7. `grep -r "tauri" packages/ --include="*.ts" --include="*.tsx" --include="*.json"` returns no results
8. `grep -r "@opencode-ai/desktop" . --include="*.ts" --include="*.tsx" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git` returns no results
9. `nix/desktop.nix` does not exist
10. `sst.config.ts` does not exist
11. `infra/` directory does not exist

## Out of Scope

- Building the new hub UI (future task)
- Modifying any core TUI or server functionality
- Changing the version number or creating a new release
- Modifying agent prompts or behavior
- Upstream sync changes
- Cleaning up the `node_modules` directory structure

## Risks

- **Catalog over-removal**: Some catalog entries might be transitively needed. The orchestrator MUST verify each entry against kept packages before removing.
- **"sidecar" false positives**: The word "sidecar" is used legitimately in `packages/opencode` for JSON agentID storage migration. These references MUST NOT be touched.
- **"desktop" false positives**: The word "desktop" may appear in terminal capability detection or display environment code. Only desktop-APP references should be removed.
- **Test count may differ**: If some tests were in deleted packages, the count may naturally change. The core opencode test suite (884 pass) should be unaffected.
- **ghostty-web patch**: The `patches/ghostty-web@0.3.0.patch` is likely used by the TUI (ghostty terminal emulator). Verify before removing.
