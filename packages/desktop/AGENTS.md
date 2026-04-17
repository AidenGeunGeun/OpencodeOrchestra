# Desktop package notes

- Never call `invoke` manually in this package.
- Use the generated bindings in `packages/desktop/src/bindings.ts` for core commands/events.

## Sidecar Binary — Never Hand-Swap

The `oco` CLI binary lives at `.app/Contents/MacOS/oco` inside the bundled desktop app. **Never replace it by copying a new binary over the existing one.** Symptoms of hand-swapping:

- `Could not reach Local Server` on launch
- Tauri sidecar fails to spawn silently
- TUI works fine (different binary path) while desktop is broken

Why it breaks: the `.app` bundle has an adhoc code signature that seals the hashes of `Contents/` files. Overwriting `oco` invalidates the seal, and macOS either blocks sidecar spawn or blocks the spawned process from binding to the local port. There is no user-facing error — just a silent failure.

The only correct way to ship a new sidecar to the desktop app is **rebuild the whole `.app`** via `bunx tauri build` (see root `AGENTS.md` → "Desktop App Rebuild"). The Tauri bundler regenerates the seal with the fresh binary's hash.

## Dev vs Prod App

Two bundle configurations, intentionally separate so risky changes can be tested side-by-side with the stable user-facing app:

| Config | Product Name | Identifier | Config File |
|--------|--------------|-----------|-------------|
| Dev | `OpenCodeOrchestra Dev` | `ai.opencode.orchestra.dev` | `src-tauri/tauri.conf.json` (default) |
| Prod | `OpenCodeOrchestra` | `ai.opencode.orchestra` | `src-tauri/tauri.prod.conf.json` |

They use separate settings directories on macOS:
- Dev: `~/Library/Application Support/ai.opencode.orchestra.dev`
- Prod: `~/Library/Application Support/ai.opencode.orchestra`

Build commands:
```sh
# Dev (default config)
bunx tauri build

# Prod (explicit config)
bunx tauri build --config src-tauri/tauri.prod.conf.json
```

**Use the Dev app to validate breaking/architectural changes before they touch the prod app.** This keeps the daily-driver app stable while risky work proceeds.

## Version

The Tauri app version is read from `package.json` (via `"version": "../package.json"` in `src-tauri/tauri.conf.json`). Keep `package.json` version in sync with all other packages (see root AGENTS.md "Version Sync").

Also bump `src-tauri/Cargo.toml` version — it's the Rust crate version shown in some system contexts.

## Desktop Builds

Tag push `oco-v<version>` triggers GitHub Actions `desktop-build` workflow. Builds macOS (Apple Silicon) and Linux (x86_64). Artifacts uploaded to GitHub Release.

**No auto-updater**: `tauri.prod.conf.json` has `"createUpdaterArtifacts": false`. Users must manually download and install new .dmg releases. Enabling requires code signing + updater endpoint.

## Skip-Local-Server

When a remote (non-loopback) HTTP server is set as default, `skipLocalServer` is automatically enabled. The sidecar is NOT spawned on next launch. Settings persist in `~/Library/Application Support/ai.opencode.orchestra` (macOS). Users don't need to reconfigure after reinstalling — just replace the .app file.
