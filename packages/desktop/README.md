# OpenCodeOrchestra Desktop

Native OpenCodeOrchestra desktop app, built with Tauri v2.

## Prerequisites

Building the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

`tauri dev` now stages a fresh local `oco` sidecar automatically by building the current-platform CLI from `packages/opencode` first.

## Build

```bash
bun run --cwd packages/desktop tauri build --config src-tauri/tauri.prod.conf.json
```

This build path also stages the local `oco` sidecar automatically before the frontend bundle step, so you do not need to copy anything into `src-tauri/sidecars` by hand.

Notes:

- The sidecar build comes from `packages/opencode/script/build.ts` and emits `dist/.../bin/oco` for the current machine.
- That script fetches the `models.dev` snapshot unless you set `MODELS_DEV_API_JSON` to a local file.
- Updater/beta distribution infrastructure remains intentionally untouched for this local-only workflow.

## Troubleshooting

### Rust compiler not found

If you see errors about Rust not being found, install it via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
