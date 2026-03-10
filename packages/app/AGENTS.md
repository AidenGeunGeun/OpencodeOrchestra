# AGENTS.md — packages/app

Guide for AI coding agents working inside the `packages/app` package.

For repo-wide conventions (style guide, naming, export patterns, error handling, release workflow) see the root `AGENTS.md`.

## What This Package Is

`packages/app` is the SolidJS single-page application (SPA) that provides the web UI for OpenCode. It is built with Vite and served by the `packages/opencode` Bun/Hono server from its `dist/` directory. There is no desktop/Tauri code in this package — it is pure web.

## Commands

| Task           | Command                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| **Build**      | `bun run build` (or `bun run --cwd packages/app build` from repo root)  |
| **Dev server** | `bun run dev` (or `bun dev -- --port 4444` to set a custom port)        |
| **Typecheck**  | `bun run typecheck` (`tsgo -b`)                                          |
| **Unit tests** | `bun run test:unit`                                                      |
| **E2E tests**  | `bun run test:e2e`                                                       |

Build output lands in `dist/`. The opencode server resolves `../../app/dist` relative to its own source and serves it automatically when present.

## Local Dev Workflow

- NEVER try to restart the app or the server process during development.
- `bun dev web` (from `packages/opencode`) proxies `https://app.opencode.ai` when no local build exists — local CSS/UI changes will not be visible there.
- For local UI development, run the backend and frontend dev servers separately:
  - Backend (`packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
  - Frontend (`packages/app`): `bun dev -- --port 4444`
  - Open `http://localhost:4444` — it connects to the backend at `http://localhost:4096`.
- ALWAYS use parallel tool calls when applicable.

## Framework Stack

- **SolidJS** — reactive UI framework (no virtual DOM)
- **@solidjs/router** — client-side routing
- **Tailwind CSS 4.x** via `@tailwindcss/vite` — utility-first styling
- **Vite** — bundler and dev server
- **@kobalte/core** — accessible headless UI primitives
- **@opencode-ai/ui** — shared design system (components + theme tokens)
- **@opencode-ai/sdk/v2** — generated API client

## Component Tree

```
entry.tsx
  PlatformProvider          # platform = "web"; openLink, notify, storage, etc.
    AppBaseProviders        # MetaProvider, Font, ThemeProvider, LanguageProvider,
                            #   UiI18nBridge, ErrorBoundary, DialogProvider,
                            #   MarkedProvider, DiffComponentProvider, CodeComponentProvider
      AppInterface          # resolves defaultServerUrl, mounts ServerProvider
        ServerProvider
          GlobalSDKProvider
            GlobalSyncProvider
              Router (@solidjs/router)
                RouterRoot
                  AppShellProviders   # SettingsProvider, PermissionProvider, LayoutProvider,
                                      #   NotificationProvider, ModelsProvider, CommandProvider,
                                      #   HighlightsProvider, Layout
                    Route "/"               → Home (lazy)
                    Route "/:dir"           → DirectoryLayout
                      Route "/session/:id?" → Session (lazy)
                                              wrapped in SessionProviders
                                              (TerminalProvider, FileProvider,
                                               PromptProvider, CommentsProvider)
```

Key entry points:

- `src/entry.tsx` — web bootstrap; constructs the `Platform` object and calls `render()`
- `src/app.tsx` — exports `AppBaseProviders` and `AppInterface`; defines the route tree
- `src/pages/layout.tsx` — `Layout` component; sidebar, project list, drag/drop, dialogs
- `src/pages/session.tsx` — `Session` component; message timeline, file tabs, terminal panel, prompt dock

## Key Contexts / Providers

| Context file               | What it provides                                                      |
| -------------------------- | --------------------------------------------------------------------- |
| `context/platform.tsx`     | `Platform` object — `platform: "web"`, browser APIs                  |
| `context/server.tsx`       | Active server URL, `ServerProvider`, `useServer`                      |
| `context/global-sdk.tsx`   | Global SDK client (`useGlobalSDK`)                                    |
| `context/global-sync.tsx`  | SSE subscription for global state                                     |
| `context/local.tsx`        | Per-directory SDK client and sync (`useLocal`)                        |
| `context/sync.tsx`         | Per-session event sync (`useSync`)                                    |
| `context/layout.tsx`       | Sidebar layout state, project list (`useLayout`)                      |
| `context/settings.tsx`     | User settings (`useSettings`)                                         |
| `context/permission.tsx`   | Permission dialog state (`usePermission`)                             |
| `context/command.tsx`      | Command palette (`useCommand`)                                        |
| `context/language.tsx`     | Active locale, translation function (`useLanguage`)                   |
| `context/terminal.tsx`     | PTY terminal instances (`useTerminal`)                                |
| `context/file.tsx`         | File viewer state (`useFile`)                                         |
| `context/prompt.tsx`       | Prompt input state (`usePrompt`)                                      |

Theme and dialog contexts come from `@opencode-ai/ui/theme` and `@opencode-ai/ui/context/dialog`.

## Routing

Routes are defined in `src/app.tsx` via `@solidjs/router`:

| Path                  | Component         | Notes                                        |
| --------------------- | ----------------- | -------------------------------------------- |
| `/`                   | `Home`            | Project selection / landing page             |
| `/:dir`               | `DirectoryLayout` | Base64-encoded project directory in `:dir`   |
| `/:dir/session/:id?`  | `Session`         | Optional session ID; creates new if absent   |

The `:dir` segment is a base64-encoded absolute path to the project directory. It is decoded and passed to the SDK client as the `x-opencode-directory` header so the server resolves the correct project context.

## SDK Connection

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const client = createOpencodeClient({
  baseUrl: serverUrl,
  directory: "/path/to/project",  // sets x-opencode-directory header
})
```

In production (server-served), `defaultServerUrl` resolves to `window.location.origin`. During Vite dev, it defaults to `http://localhost:4096`. Override with `VITE_OPENCODE_SERVER_HOST` / `VITE_OPENCODE_SERVER_PORT`.

## Platform

`context/platform.tsx` defines the `Platform` type with `platform: "web"` as a literal. There are no Tauri, Electron, or native code paths in this package. All capabilities (notifications, file pickers, storage) use standard browser APIs.

```ts
const platform: Platform = {
  platform: "web",
  openLink: (url) => window.open(url, "_blank"),
  notify: async (title, description, href) => { /* Notification API */ },
  restart: async () => { window.location.reload() },
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  getDefaultServerUrl: () => localStorage.getItem("opencode.settings.dat:defaultServerUrl"),
  setDefaultServerUrl: (url) => { /* localStorage */ },
}
```

## Responsive Design

Tailwind breakpoints (defined in `@opencode-ai/ui/src/styles/tailwind/index.css`):

| Breakpoint | rem   | px   |
| ---------- | ----- | ---- |
| `sm`       | 40rem | 640  |
| `md`       | 48rem | 768  |
| `lg`       | 64rem | 1024 |
| `xl`       | 80rem | 1280 |
| `2xl`      | 96rem | 1536 |

The session page switches between desktop and mobile layouts using a JS media query at 1024 px (`createMediaQuery` from `@solid-primitives/media`). Below 1024 px, `SessionMobileTabs` replaces the side panel. Use Tailwind breakpoint prefixes (`lg:`, `md:`) for CSS-driven responsive changes.

## i18n

Locale dictionaries live in `src/i18n/`. English (`en.ts`) is the canonical source of truth. Other supported locales: `zh`, `zht`, `ja`, `ko`, `de`, `fr`, `es`, `br`, `ru`, `pl`, `no`, `da`, `th`, `ar`, `bs`.

The active locale is detected from `navigator.languages` at startup and exposed via `useLanguage()`. `UiI18nBridge` connects `LanguageProvider` to `@opencode-ai/ui`'s `I18nProvider`.

Translation key parity is enforced by `src/i18n/parity.test.ts` (run with `bun run test:unit`).

## Public Assets

Static files in `public/` are copied verbatim to `dist/` by Vite:

- `favicon-96x96-v3.png`, `apple-touch-icon-v3.png`, `web-app-manifest-*.png` — favicons and PWA icons (sourced from `packages/ui/src/assets/favicon/`)
- `social-share.png`, `social-share-zen.png` — OG image assets

When updating favicon assets, update the source files in `packages/ui/src/assets/favicon/` and copy outputs into `packages/app/public/`.

## SolidJS Conventions

- Always prefer `createStore` over multiple `createSignal` calls.
- Use `createMemo` for derived values; avoid recomputing in render functions.
- Prefer Tailwind utility classes; avoid inline `style` attributes.
- Use CSS custom properties from `@opencode-ai/ui` theme (e.g., `var(--background-surface)`, `var(--text-primary)`) when a value has no Tailwind class equivalent.
- Follow the root `AGENTS.md` style guide: `const` over `let`, avoid `else`, namespace exports.
- Component files use `kebab-case.tsx`.
- Do not add Tauri, Capacitor, or any native/desktop SDK imports — this package is web-only.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` — navigate to page
2. `agent-browser snapshot -i` — get interactive elements with refs (`@e1`, `@e2`, …)
3. `agent-browser click @e1` / `agent-browser fill @e2 "text"` — interact using refs
4. Re-snapshot after page changes
