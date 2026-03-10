# Local Web UI + Responsive Fix

## Intent

Transform OpenCodeOrchestra into a self-hosted web experience: serve the web frontend locally (no upstream proxy dependency), fix mobile responsiveness, and strip the Tauri desktop app and unused upstream packages. The result: `oco serve` gives you a fully self-contained, mobile-friendly web UI on your home server, accessible from any device over the network.

## Context

OpenCodeOrchestra v1.0.7 forks upstream opencode v1.2.5. The server currently proxies unmatched routes to `app.opencode.ai` for the web frontend. The user wants to:

1. Own the frontend locally — no dependency on upstream hosting
2. Use the web UI from a lightweight laptop and phone over Tailscale
3. Work on multiple projects simultaneously via browser tabs (one tab = one project)
4. Not need the TUI or terminal at all for daily use

The server already supports multiple projects per process via request-scoped `directory` parameter. The web frontend (`packages/app`) is a SolidJS SPA that builds with Vite. The web UI has responsive breakpoints but the mobile layout wastes too much screen on chrome (88px of fixed headers + oversized prompt dock = ~40% of phone screen).

## Goals

1. Serve `packages/app` build output locally from the `oco serve`/`oco web` server
2. Fix mobile responsive layout so the web UI is usable on phones and small laptops
3. Strip the Tauri desktop app and unused upstream packages (11 packages)
4. Clean desktop-specific code from the kept packages (app, ui)

---

## Part 1: Strip Desktop + Unused Packages

### Delete 11 package directories

```
packages/desktop/      # Tauri desktop app (primary target)
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

### Packages kept (7 total)

```
packages/opencode/     # Core TUI + server
packages/app/          # Web frontend (SolidJS SPA)
packages/ui/           # UI component library (used by app)
packages/sdk/          # JS SDK
packages/plugin/       # Plugin API
packages/script/       # Version/release tooling
packages/util/         # Shared utilities
```

### Delete infrastructure files

- `nix/desktop.nix`
- `sst.config.ts` (SST cloud deployment — references deleted console/enterprise)
- `sst-env.d.ts`
- `infra/` directory (all files: app.ts, console.ts, enterprise.ts, secret.ts, stage.ts)
- `OpenCodeOrchestra-v0.4.0.zip` (stale archive in repo root)
- `nul` (Windows artifact in repo root)

### Clean `flake.nix`

Remove desktop package lines:
```nix
# DELETE these lines:
desktop = pkgs.callPackage ./nix/desktop.nix {
  inherit opencode;
};

# CHANGE this line:
inherit opencode desktop;
# TO:
inherit opencode;
```

### Clean root `package.json`

**Workspaces** — remove deleted paths:
```json
"workspaces": {
  "packages": [
    "packages/*",
    "packages/sdk/js"
  ]
}
```
Remove `"packages/console/*"` and `"packages/slack"`.

**Dependencies** — remove:
- `"@aws-sdk/client-s3"` (only used by deleted cloud infra)

**DevDependencies** — remove:
- `"sst"` (SST no longer needed)

**Catalog** — remove entries used ONLY by deleted packages. Before removing ANY entry, the orchestrator MUST grep the 7 kept packages to confirm it's unused. Entries to evaluate:
- `"@cloudflare/workers-types"` — used by function (deleted)
- `"@openauthjs/openauth"` — used by console/function (deleted)
- `"@solidjs/meta"` — used by console/enterprise (deleted) — check if app uses it
- `"@solidjs/start"` — used by console/enterprise (deleted) — app does NOT use this
- `"dompurify"` — check if app uses it

**IMPORTANT**: `packages/app` and `packages/ui` are KEPT, so most catalog entries used by them must STAY. Only remove entries exclusively used by the 11 deleted packages.

### Clean `turbo.json`

Remove `@opencode-ai/app#test` task entry ONLY IF we are not running app tests. If app tests are kept, leave it.

### Clean CI (`.github/workflows/test.yml`)

The Windows matrix entry runs e2e tests in `packages/app`:
- **If app e2e tests still work** after Part 2 changes: keep the Windows matrix but update any broken paths
- **If app e2e tests are broken** by the desktop removal: remove the Windows matrix entry and related Playwright steps

After cleanup, at minimum the Linux job (typecheck + opencode tests) must remain.

### Clean `CONTRIBUTING.md`

- Lines 70-71: Remove `packages/desktop` reference. Update `packages/app` description to say "Web frontend" instead of "shared web UI components"
- Lines 119-146: Remove "Running the Desktop App" section entirely
- Lines 232-234: Remove `fix(desktop):` PR title example

### Clean translated READMEs

- `README.zh-CN.md` (lines ~43-56): Remove desktop download section
- `README.zh-TW.md` (lines ~43-56): Remove desktop download section

### Clean remaining cross-references

Search ALL remaining files for references to deleted packages and fix:
- `@opencode-ai/desktop`, `@opencode-ai/enterprise`, `@opencode-ai/function`, `@opencode-ai/docs` — remove
- `packages/desktop`, `packages/console`, `packages/web`, `packages/docs` — remove path references
- `tauri` — remove in desktop-app context (NOT as general English word)
- `sidecar` — remove in desktop-app context (NOT in `packages/opencode`'s JSON agentID storage context, which is legitimate)

Files to specifically check: `AGENTS.md`, `UPSTREAM-DIFF.md`, `BACKLOG.md`, `STATS.md`, `.prettierignore`, `.gitignore`, `github/`, `themes/`, `patches/`.

### Strip desktop-specific code from `packages/app`

The app has desktop-specific code guarded by `platform.platform !== "desktop"` checks. Remove:

- `packages/app/src/components/titlebar.tsx`: Remove Tauri window control code (`window.__TAURI__` references, drag regions, native maximize/minimize). Keep the titlebar component itself — it's used by web too.
- `packages/app/src/components/settings-general.tsx` (lines ~375-499): Remove WSL toggle, display backend selector, webview zoom settings, and update checker — these are desktop-only settings.
- `packages/app/src/components/dialog-settings.tsx`: Remove desktop-only settings sections from the settings dialog.
- `packages/app/src/context/platform.tsx`: Remove desktop-only fields from the Platform interface (`os`, `openPath`, `checkUpdate`, `getWslEnabled`, `getDisplayBackend`, `webviewZoom`, `readClipboardImage`) and their type definitions.
- `packages/app/src/utils/persist.ts` (lines ~321-358): Remove Tauri store-based persistence code.
- `packages/app/src/pages/layout.tsx`: Remove desktop update/help links that reference Tauri updater.
- `packages/app/src/pages/error.tsx`: Remove desktop restart/update hooks.
- `packages/app/src/components/session/session-header.tsx` (lines ~82-90, ~230-289): Remove desktop file-opening logic (Tauri native open).
- `packages/app/src/i18n/en.ts` (lines ~582-590) and ALL locale files: Remove `app.name.desktop`, `settings.section.desktop`, WSL, and other desktop-only i18n strings.

**SAFETY**: Only remove code paths that are gated on `platform === "desktop"` or reference `@tauri-apps/*` APIs. Do NOT remove web-functional code.

### Strip desktop traces from `packages/ui`

- Remove `packages/ui/src/theme/desktop-theme.schema.json`
- Remove `$schema` references to `desktop-theme.schema.json` from theme JSON files (e.g., `packages/ui/src/theme/themes/aura.json` line 2)
- Remove desktop/Tauri-specific icon SVGs:
  - `packages/ui/src/assets/icons/file-types/tauri.svg`
  - `packages/ui/src/assets/icons/file-types/folder-src-tauri.svg`
  - `packages/ui/src/assets/icons/file-types/folder-src-tauri-open.svg`
  - `packages/ui/src/assets/icons/file-types/folder-desktop.svg`
  - `packages/ui/src/assets/icons/file-types/folder-desktop-open.svg`

---

## Part 2: Serve Frontend Locally

### Current behavior (to change)

File: `packages/opencode/src/server/server.ts`, lines 541-556

The catch-all route proxies unmatched requests to `https://app.opencode.ai`:
```typescript
.all("/*", async (c) => {
  const path = c.req.path
  const response = await proxy(`https://app.opencode.ai${path}`, { ... })
  // ...
  return response
})
```

### New behavior

Replace the proxy catch-all with local static file serving. The server should:

1. Look for built frontend assets at a known location
2. Serve static files (JS, CSS, images, etc.) with correct MIME types
3. For HTML routes (non-file paths), serve `index.html` (SPA fallback)
4. Retain appropriate CSP headers

### Asset location strategy

The server should look for frontend assets in this order:
1. **Environment variable**: `OPENCODE_FRONTEND_DIR` — explicit path to built frontend
2. **Monorepo-relative**: `../../app/dist/` relative to `packages/opencode/` — works during development
3. **Fallback**: If no local assets found, fall back to the existing proxy behavior (preserves backward compatibility)

### Implementation approach

Use Bun's file serving capabilities in the Hono catch-all:

```typescript
.all("/*", async (c) => {
  const path = c.req.path

  // Try to serve local frontend assets
  const frontendDir = resolveFrontendDir()
  if (frontendDir) {
    // Try exact file match first (for JS, CSS, images, etc.)
    const filePath = join(frontendDir, path)
    const file = Bun.file(filePath)
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": file.type },
      })
    }

    // SPA fallback: serve index.html for non-file routes
    const indexFile = Bun.file(join(frontendDir, "index.html"))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy": "...",
        },
      })
    }
  }

  // Fallback: proxy to upstream (backward compatibility)
  const response = await proxy(`https://app.opencode.ai${path}`, { ... })
  // ...
  return response
})
```

### `resolveFrontendDir` logic

```typescript
function resolveFrontendDir(): string | null {
  // 1. Explicit override
  if (process.env.OPENCODE_FRONTEND_DIR) {
    return process.env.OPENCODE_FRONTEND_DIR
  }

  // 2. Monorepo-relative (for development)
  const monorepoPath = join(import.meta.dirname, "../../app/dist")
  if (existsSync(monorepoPath)) {
    return monorepoPath
  }

  // 3. XDG data directory (for installed deployments)
  const xdgPath = join(Global.Path.data(), "frontend")
  if (existsSync(xdgPath)) {
    return xdgPath
  }

  return null // will fall back to proxy
}
```

### Build integration

Add a script or build step that builds `packages/app` and optionally copies the output to the XDG data directory. For development, `bun run --cwd packages/app build` suffices — the monorepo-relative detection handles it.

The `oco web` command should check if local frontend is available and print a message:
- If local: `Local frontend: serving from /path/to/dist`
- If proxied: `Frontend: proxied from app.opencode.ai (build packages/app for local serving)`

### Verify SDK client connects correctly

The web frontend uses `@opencode-ai/sdk/v2` with a configurable server URL stored in localStorage (`opencode.settings.dat:defaultServerUrl`). When served from the same origin as the API, the default server URL should be empty/null (meaning same-origin). Verify this works correctly — the SDK client should make API calls to the same host.

If the SDK client requires an explicit URL, ensure the default for same-origin serving is `window.location.origin`.

---

## Part 3: Responsive CSS Fix

### Problem

On mobile screens (~375-430px wide, ~700-850px tall), the fixed UI chrome takes ~40% of the viewport:
- Titlebar: 40px (`h-10`)
- Mobile tab strip: 48px (Tabs.List default)
- Prompt dock: variable, typically 200px+ (`pt-12 pb-4` padding + `max-h-[240px]` editor + toolbar)
- Total chrome: ~288px+ on a 700px screen

### Fix 1: Compact titlebar on mobile

File: `packages/app/src/components/titlebar.tsx`

The titlebar uses `h-10` (40px). On small screens, reduce to `h-8` (32px):
```
h-10  →  h-8 sm:h-10
```
This saves 8px. Also update the mobile sidebar `top-10` reference in layout.tsx to match.

### Fix 2: Compact mobile tab strip

File: `packages/app/src/pages/session/session-mobile-tabs.tsx` and `packages/ui/src/components/tabs.css`

The mobile tab strip is 48px. Reduce to 36px on small screens:
- Add a responsive height class or CSS override for the Tabs.List in mobile context
- Or reduce the base tab height in the component CSS

This saves 12px.

### Fix 3: Reduce prompt dock on mobile

Files:
- `packages/app/src/pages/session/session-prompt-dock.tsx`
- `packages/app/src/components/prompt-input.tsx`

Current: `pt-12 pb-4` padding, `max-h-[240px]` editor

Mobile fix:
- Reduce padding: `pt-12 pb-4` → `pt-6 pb-2 sm:pt-12 sm:pb-4`
- Reduce max editor height: `max-h-[240px]` → `max-h-[120px] sm:max-h-[240px]`
- Consider making the prompt dock collapsible or auto-hiding when not focused

This saves ~70-120px.

### Fix 4: Update bottom padding calculations

File: `packages/app/src/pages/session/message-timeline.tsx`

The timeline uses `pb-[calc(var(--prompt-height,8rem)+64px)]` on mobile. After reducing the prompt dock, verify this calculation still works correctly. The `--prompt-height` CSS variable is dynamically measured, so it should auto-adjust, but verify the fallback value (`8rem`) and the `+64px` offset are appropriate.

### Fix 5: Verify responsive breakpoints are consistent

The app uses mixed breakpoint approaches:
- Tailwind: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px)
- JS media query: `1024px` for desktop/mobile mode switch

Ensure all responsive changes use consistent breakpoints. The mobile compact layout should apply below `sm` (640px) — this covers all phones and small tablets.

### Net effect

| Element          | Before | After (mobile) | Savings |
| ---------------- | ------ | --------------- | ------- |
| Titlebar         | 40px   | 32px            | 8px     |
| Mobile tabs      | 48px   | 36px            | 12px    |
| Prompt dock      | ~200px | ~130px          | ~70px   |
| **Total savings**    |        |                 | **~90px**   |

On a 700px phone: chrome goes from ~288px (41%) to ~198px (28%). Content area grows from ~412px to ~502px — a **22% increase** in usable space.

---

## Acceptance Criteria

### Part 1 (Cleanup)
- Only 7 packages remain under `packages/`: `opencode`, `app`, `ui`, `sdk`, `plugin`, `script`, `util`
- No imports from deleted packages remain
- No Tauri/desktop-app-specific code remains in `packages/app` or `packages/ui`
- `bun install` succeeds
- `bun turbo typecheck` succeeds
- `bun turbo test` — opencode tests pass (target: 884 pass / 0 fail)

### Part 2 (Local Frontend)
- `bun run --cwd packages/app build` produces `packages/app/dist/` with `index.html` and assets
- `oco serve` (or equivalent dev command) serves the local frontend at `/`
- The web UI loads in a browser and connects to the API on the same origin
- Session listing, creation, and messaging work through the locally-served frontend
- If `packages/app/dist/` does not exist, falls back to proxying `app.opencode.ai`

### Part 3 (Responsive)
- On a 375px-wide viewport, the titlebar is 32px tall
- On a 375px-wide viewport, the prompt dock uses reduced padding and max-height
- Content area is at least 55% of viewport height on a 700px-tall phone screen
- No layout breakage on desktop viewports (1024px+)

---

## Execution Order

1. Part 1 first (cleanup) — establishes the clean package set
2. Part 2 next (local frontend serving) — must be done after cleanup since we're modifying server.ts
3. Part 3 last (responsive CSS) — can be verified once local serving works

## Test Cases

1. `bun install` exits 0
2. `bun turbo typecheck` exits 0
3. `bun turbo test` passes
4. `ls packages/` shows exactly: `app  opencode  plugin  script  sdk  ui  util`
5. `bun run --cwd packages/app build` exits 0
6. `oco serve --port 4096` serves the web UI at `http://localhost:4096/`
7. Opening `http://localhost:4096/` in a browser shows the OpenCode web UI
8. The web UI can list sessions and create a new session
9. On a 375px-wide responsive test, content area is >55% of 700px viewport
10. `grep -r "tauri" packages/app/src/ packages/ui/src/ --include="*.ts" --include="*.tsx"` returns no results
11. `grep -r "@opencode-ai/desktop" . --include="*.ts" --include="*.tsx" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git` returns no results

## Out of Scope

- Building a separate hub/dashboard page (future task, if needed)
- Modifying core TUI or server functionality beyond the catch-all route change
- Changing the version number or creating a release
- Modifying agent prompts
- Production binary asset embedding (future — for now, monorepo-relative + env var is sufficient)
- Improving project switching speed within the SPA (separate investigation)

## Risks

- **"sidecar" false positives**: The word "sidecar" in `packages/opencode` for JSON agentID storage is LEGITIMATE. Do NOT remove.
- **"desktop" false positives**: The word "desktop" in terminal capability detection or display environment code is LEGITIMATE. Only remove desktop-APP references.
- **App build dependencies**: `packages/app` depends on `@opencode-ai/ui`, which must build first. Ensure Turbo build order handles this.
- **SDK same-origin detection**: The SDK client may need the server URL to be set explicitly. If same-origin inference doesn't work, add auto-detection logic in the web entry.
- **Catalog entry removal**: Overly aggressive catalog cleanup could break app/ui builds. Verify each removal against ALL 7 kept packages.
- **ghostty-web patch**: Used by the TUI (ghostty terminal emulator in packages/opencode). Must be kept.
