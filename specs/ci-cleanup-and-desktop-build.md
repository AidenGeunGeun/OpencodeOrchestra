# CI Cleanup + Desktop Build Workflow — Execution Spec

## Intent
Strip upstream CI infrastructure designed for a multi-contributor SaaS project. Replace with lean CI for a single-developer fork: lightweight test validation on push, and a tag-triggered desktop app build that produces downloadable macOS + Linux artifacts via GitHub Releases.

## Context
- Repo: `AidenGeunGeun/OpenCodeOrchestra` on GitHub, branch `main`
- Existing CI uses Blacksmith runners (paid, upstream-specific) and triggers on `dev` branch (upstream default)
- Desktop sidecar scripts still reference upstream binary names (`opencode-*`) but our build produces `@skybluejacket/oco-*` with binary named `oco` (not `opencode`)
- `tauri.prod.conf.json` points updater to upstream GitHub releases
- Dockerfile references upstream musl binary naming
- Release flow: `bun run release [patch|minor|major]` → commits + tags `oco-v{VERSION}` → push tag triggers desktop build

## Part 1: Delete Stale CI Files

### Delete these files:
1. `.github/workflows/typecheck.yml` — redundant (test.yml already runs typecheck), wrong branch, wrong runner
2. `.github/pull_request_template.md` — solo developer, no value
3. `packages/opencode/Dockerfile` — references upstream binary names (`opencode-linux-x64-baseline-musl`), Docker not used

## Part 2: Fix test.yml

### File: `.github/workflows/test.yml`

Replace the entire file with a simplified version:

**Trigger**: push to `main`, `workflow_dispatch` (manual). Remove `pull_request` trigger.

**Runner**: `ubuntu-latest` (not `blacksmith-4vcpu-ubuntu-2404`)

**Steps**:
1. Checkout
2. Setup Bun (use existing `.github/actions/setup-bun` composite action)
3. Run `bun turbo typecheck`
4. Run `bun turbo test`

**Remove entirely**:
- Matrix strategy (only one target: linux)
- E2E seed step (`bun script/seed-e2e.ts`)
- Server startup step (`bun dev serve`)
- Server health wait loop
- All Playwright/e2e env vars (`PLAYWRIGHT_SERVER_HOST`, `VITE_OPENCODE_SERVER_PORT`, `OPENCODE_CLIENT`, etc.)
- Windows path handling (no Windows target)
- XDG/OPENCODE_E2E env vars

**Keep these env vars** (needed for tests to run without side effects):
- `CI: true`
- `OPENCODE_DISABLE_SHARE: "true"`
- `OPENCODE_DISABLE_LSP_DOWNLOAD: "true"`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS: "true"`
- `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true"`

**Timeout**: 15 minutes (down from 30)

## Part 3: Fix Desktop Sidecar Scripts

### File: `packages/desktop/scripts/utils.ts`

Update `SIDECAR_BINARIES` array — change `ocBinary` values from upstream `opencode-*` to our `@skybluejacket/oco-*` naming:

| rustTarget | old ocBinary | new ocBinary |
|---|---|---|
| `aarch64-apple-darwin` | `opencode-darwin-arm64` | `@skybluejacket/oco-darwin-arm64` |
| `x86_64-apple-darwin` | `opencode-darwin-x64-baseline` | `@skybluejacket/oco-darwin-x64-baseline` |
| `aarch64-pc-windows-msvc` | `opencode-windows-arm64` | `@skybluejacket/oco-windows-arm64` |
| `x86_64-pc-windows-msvc` | `opencode-windows-x64-baseline` | `@skybluejacket/oco-windows-x64-baseline` |
| `x86_64-unknown-linux-gnu` | `opencode-linux-x64-baseline` | `@skybluejacket/oco-linux-x64-baseline` |
| `aarch64-unknown-linux-gnu` | `opencode-linux-arm64` | `@skybluejacket/oco-linux-arm64` |

### File: `packages/desktop/scripts/predev.ts`

Change the binary path from:
```typescript
const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)
```
To:
```typescript
const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/oco`)
```

## Part 4: Fix Desktop Prod Config

### File: `packages/desktop/src-tauri/tauri.prod.conf.json`

1. Change `productName` from `"OpenCode"` to `"OpenCode Orchestra"`
2. Change `identifier` from `"ai.opencode.desktop"` to `"ai.opencode.orchestra"`
3. Remove the `plugins.updater` section entirely (we distribute via GitHub Releases manually, not auto-updater; the upstream pubkey won't work for our releases anyway)

## Part 5: Create Desktop Build Workflow

### File: `.github/workflows/desktop-build.yml`

**Name**: `desktop-build`

**Trigger**: push tags matching `oco-v*` only. No other triggers except `workflow_dispatch` for manual testing.

**Matrix**:
```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - name: macOS (Apple Silicon)
        runner: macos-latest
        rust-target: aarch64-apple-darwin
      - name: Linux (x86_64)
        runner: ubuntu-latest
        rust-target: x86_64-unknown-linux-gnu
```

Note: `macos-latest` on GitHub Actions is ARM (M-series) by default now. No need for `macos-14` or explicit arch.

**Steps** (for each matrix entry):

1. **Checkout**
   ```yaml
   - uses: actions/checkout@v4
   ```

2. **Setup Bun** (reuse composite action)
   ```yaml
   - uses: ./.github/actions/setup-bun
   ```

3. **Setup Rust**
   ```yaml
   - uses: dtolnay/rust-toolchain@stable
   ```

4. **Cache Rust** (cargo registry + target dir)
   ```yaml
   - uses: actions/cache@v4
     with:
       path: |
         ~/.cargo/registry
         ~/.cargo/git
         packages/desktop/src-tauri/target
       key: ${{ runner.os }}-cargo-${{ hashFiles('packages/desktop/src-tauri/Cargo.lock') }}
       restore-keys: ${{ runner.os }}-cargo-
   ```

5. **Install Linux deps** (only on ubuntu)
   ```yaml
   - if: runner.os == 'Linux'
     run: |
       sudo apt-get update
       sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
   ```

6. **Build sidecar binary**
   ```yaml
   - name: Build sidecar
     working-directory: packages/opencode
     run: bun run script/build.ts --single --skip-install
     env:
       TAURI_ENV_TARGET_TRIPLE: ${{ matrix.rust-target }}
   ```

7. **Copy sidecar to Tauri sidecars dir**
   ```yaml
   - name: Copy sidecar
     working-directory: packages/desktop
     run: bun run scripts/predev.ts
     env:
       TAURI_ENV_TARGET_TRIPLE: ${{ matrix.rust-target }}
   ```
   Note: `predev.ts` already calls `copyBinaryToSidecarFolder`. After Part 3 fixes, it will use the correct binary name.

8. **Build Tauri app** (production config)
   ```yaml
   - name: Build desktop app
     working-directory: packages/desktop
     run: bunx tauri build --config src-tauri/tauri.prod.conf.json
   ```

9. **Upload artifacts to GitHub Release**
   ```yaml
   - name: Upload to Release
     uses: softprops/action-gh-release@v2
     with:
       files: |
         packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg
         packages/desktop/src-tauri/target/release/bundle/macos/*.app.tar.gz
         packages/desktop/src-tauri/target/release/bundle/deb/*.deb
         packages/desktop/src-tauri/target/release/bundle/rpm/*.rpm
         packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage
       tag_name: ${{ github.ref_name }}
       generate_release_notes: true
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

**Permissions** (needed for release creation):
```yaml
permissions:
  contents: write
```

## Acceptance Criteria
1. `.github/workflows/typecheck.yml`, `.github/pull_request_template.md`, `packages/opencode/Dockerfile` are deleted
2. `test.yml` triggers on push to `main`, uses `ubuntu-latest`, runs typecheck + test only (no e2e/Playwright)
3. `packages/desktop/scripts/utils.ts` has correct `@skybluejacket/oco-*` binary names
4. `packages/desktop/scripts/predev.ts` references `bin/oco` not `bin/opencode`
5. `tauri.prod.conf.json` has updated product name/identifier, no updater section
6. `desktop-build.yml` exists with tag-triggered macOS + Linux matrix
7. `bun turbo typecheck` passes
8. No references to `blacksmith` runners remain in `.github/`

## Out of Scope
- Windows desktop build (no Windows device)
- macOS code signing / notarization (can add later if Gatekeeper becomes annoying)
- Auto-updater infrastructure (manual download from GitHub Releases is fine)
- Tauri dev config changes (`tauri.conf.json` stays as-is for local dev)
