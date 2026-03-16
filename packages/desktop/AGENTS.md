# Desktop package notes

- Never call `invoke` manually in this package.
- Use the generated bindings in `packages/desktop/src/bindings.ts` for core commands/events.

## Version

The Tauri app version is read from `package.json` (via `"version": "../package.json"` in `src-tauri/tauri.conf.json`). Keep `package.json` version in sync with all other packages (see root AGENTS.md "Version Sync").

Also bump `src-tauri/Cargo.toml` version — it's the Rust crate version shown in some system contexts.

## Desktop Builds

Tag push `oco-v<version>` triggers GitHub Actions `desktop-build` workflow. Builds macOS (Apple Silicon) and Linux (x86_64). Artifacts uploaded to GitHub Release.

**No auto-updater**: `tauri.prod.conf.json` has `"createUpdaterArtifacts": false`. Users must manually download and install new .dmg releases. Enabling requires code signing + updater endpoint.

## Skip-Local-Server

When a remote (non-loopback) HTTP server is set as default, `skipLocalServer` is automatically enabled. The sidecar is NOT spawned on next launch. Settings persist in `~/Library/Application Support/ai.opencode.orchestra` (macOS). Users don't need to reconfigure after reinstalling — just replace the .app file.
