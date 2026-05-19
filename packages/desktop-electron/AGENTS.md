# Desktop package notes (Electron — current prod shell)

This is the **user-facing prod desktop shell** for OCO. Installed as `/Applications/OpenCodeOrchestra.app` (macOS, identifier `ai.opencode.orchestra.electron`). The legacy Tauri shell lives at `packages/desktop/` and is still built by CI but slated for retirement; see root `AGENTS.md` → "Two Shells (Electron prod, Tauri legacy)" for the overall picture.

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
- Local packaging is intentionally unsigned by default. Set `ELECTRON_SIGN=true` or provide `CSC_LINK`/`CSC_NAME` to sign macOS builds, and set `ELECTRON_NOTARIZE=true` only when Apple notarization credentials are available.
- Electron packaging validates the bundled main bundle, native modules, sidecar fallback binary, and icons before/after packaging. Missing runtime artifacts should fail the package command instead of producing a silently broken app.
- SQLite uses Node's built-in `node:sqlite` (Node 22+, Electron 41+). No external SQLite driver, no `bindings`/`file-uri-to-path` dependencies, no SQLite-related `asarUnpack` entries. The packaged smoke must still hit a DB-backed route such as `/session`, because `/global/health` can pass before SQLite opens.
- **CI**: `.github/workflows/desktop-electron-build.yml` runs on every `oco-v*` tag push and uploads `oco-electron-*` assets (macOS `.dmg`/`.zip`, Linux `.deb`/`.rpm`/`.AppImage`) to the GitHub Release. It runs alongside the Tauri `desktop-build` workflow until Tauri is retired. Windows is intentionally not built — the Bun cross-runtime download for Windows baseline is unreliable on github-hosted runners.
- The default in-process backend is consumed via `import("virtual:opencode-server")` from the bundled main; do not reintroduce a runtime `pathToFileURL(out/backend/...)` import. Sidecar mode is preserved as an opt-in escape hatch via `OCO_ELECTRON_BACKEND=sidecar` (`OPENCODE_ELECTRON_BACKEND` is also accepted).
- The Electron main entry stays small and dynamic-imports the backend chunk emitted into `out/main/chunks/`. That deferred boundary lets `prepareServerEnv` mutate `process.env` (`OPENCODE_SERVER_USERNAME=oco`, password, etc.) before the backend chunk's module-init code captures the values, so we do not need to alter shared `Flag` semantics. Do NOT enable `output.inlineDynamicImports` on the main bundle. The Vite main config externalises only the `@lydell/node-pty` platform package; everything else (including `@parcel/watcher` and `jsonc-parser`) is bundled into the backend chunk. `electron-builder` auto-unpacks the lydell native binary; do not reintroduce explicit `asarUnpack` entries unless a new native module requires it.
- Tree-sitter `.wasm` files emitted by `bun script/build-node.ts` are copied next to the bundled main so runtime relative URLs continue to resolve. The copy plugin is a no-op when no `.wasm` files exist.
- The packaged smoke launches the produced `.app` once per backend mode (`in-process`, then `sidecar`), driving startup with a fixed `OCO_PORT`/`OCO_ELECTRON_SMOKE_PASSWORD` and exercising `/global/health`, `/session?directory=…`, and `/pty?directory=…`. Use `OCO_ELECTRON_SKIP_PACKAGED_SMOKE=1` only as a temporary escape hatch.

## Local rebuild + install (macOS)

```sh
# Build (channel: prod / dev / beta)
OPENCODE_CHANNEL=prod bun run package:electron:mac

# Install
osascript -e 'tell application "OpenCodeOrchestra" to quit'
rm -rf /Applications/OpenCodeOrchestra.app
cp -R packages/desktop-electron/dist/mac-arm64/OpenCodeOrchestra.app /Applications/

# Verify
defaults read /Applications/OpenCodeOrchestra.app/Contents/Info.plist CFBundleIdentifier
# Expect: ai.opencode.orchestra.electron
```

Channel → identifier / product name mapping (from `electron-builder.config.ts`):

| `OPENCODE_CHANNEL` | Product Name              | App Identifier                       | App Support Dir                                |
| ------------------ | ------------------------- | ------------------------------------ | ---------------------------------------------- |
| `prod`             | `OpenCodeOrchestra`       | `ai.opencode.orchestra.electron`     | `~/Library/Application Support/ai.opencode.orchestra.electron/`     |
| `dev`              | `OpenCodeOrchestra Dev`   | `ai.opencode.orchestra.electron.dev` | `~/Library/Application Support/ai.opencode.orchestra.electron.dev/` |
| `beta`             | `OpenCodeOrchestra Beta`  | `ai.opencode.orchestra.electron.beta`| `~/Library/Application Support/ai.opencode.orchestra.electron.beta/` |

Channels use separate Application Support directories so all three can run side-by-side without clobbering each other's renderer-process state. The shared backend SQLite at `~/.local/share/oco/oco.db` is touched by whichever channel is running at any moment — keep that in mind when running multiple side-by-side.
