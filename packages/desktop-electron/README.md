# OpenCodeOrchestra Electron Desktop

Native OpenCodeOrchestra desktop shell, built with Electron while Tauri remains available during migration.

## Development

From the repo root:

```bash
bun install
bun run dev:electron
```

This starts the Electron dev server, launches the Electron shell, and starts the managed local OCO sidecar server.

## Build

To build the Electron renderer/main/preload output:

```bash
bun run build:electron
```

## Prerequisites

Running the Electron app requires Bun and the Electron dependencies installed by `bun install`. The current migration keeps a managed Bun sidecar for the OCO backend; future phases may switch Electron to an in-process Node-compatible backend.
