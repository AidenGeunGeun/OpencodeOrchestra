#!/usr/bin/env bun

/**
 * Local release script for OpenCodeOrchestra.
 *
 * Usage:
 *   bun run release           # patch bump (1.0.8 → 1.0.9)
 *   bun run release minor     # minor bump (1.0.8 → 1.1.0)
 *   bun run release major     # major bump (1.0.8 → 2.0.0)
 *   bun run release 1.2.3     # explicit version
 *
 * What it does:
 *   1. Bumps version in ALL package.json files
 *   2. Runs bun install (updates lockfile)
 *   3. Runs turbo typecheck
 *   4. Builds frontend (packages/app)
 *   5. Builds CLI binary for current platform (packages/opencode)
 *   6. Copies frontend to XDG data dir
 *   7. Git commits and tags (oco-v{version})
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import os from "os"

const ROOT = path.resolve(import.meta.dirname, "..")
process.chdir(ROOT)

// ── Parse arguments ──────────────────────────────────────────────────────────

const arg = process.argv[2] ?? "patch"

// Read current version from packages/opencode/package.json (source of truth)
const opencodePkg = await Bun.file(path.join(ROOT, "packages/opencode/package.json")).json()
const current = opencodePkg.version as string

function bumpVersion(version: string, type: string): string {
  // Explicit version
  if (/^\d+\.\d+\.\d+/.test(type)) return type

  const [major, minor, patch] = version.split(".").map(Number)
  switch (type) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
    default:
      console.error(`Unknown bump type: ${type}. Use patch, minor, major, or an explicit version.`)
      process.exit(1)
  }
}

const next = bumpVersion(current, arg)

console.log(`\n  OpenCodeOrchestra Release`)
console.log(`  ────────────────────────`)
console.log(`  ${current} → ${next}\n`)

// ── Step 1: Bump versions ────────────────────────────────────────────────────

console.log("▸ Bumping versions in all package.json files...")

const pkgFiles = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({ absolute: true, cwd: ROOT }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

let bumped = 0
for (const file of pkgFiles) {
  const text = await Bun.file(file).text()
  const updated = text.replace(/"version":\s*"[^"]+"/g, `"version": "${next}"`)
  if (updated !== text) {
    await Bun.file(file).write(updated)
    bumped++
  }
}
console.log(`  Updated ${bumped} files`)

// ── Step 2: bun install ──────────────────────────────────────────────────────

console.log("\n▸ Running bun install...")
await $`bun install`.quiet()
console.log("  Done")

// ── Step 3: Typecheck ────────────────────────────────────────────────────────

console.log("\n▸ Running typecheck...")
const tc = await $`bun turbo typecheck`.nothrow().quiet()
if (tc.exitCode !== 0) {
  console.error("  ✗ Typecheck failed:")
  console.error(tc.stderr.toString())
  process.exit(1)
}
console.log("  ✓ All packages pass")

// ── Step 4: Build binary (includes frontend build) ───────────────────────────

console.log("\n▸ Building CLI binary (current platform)...")
// build.ts --single builds only for current os/arch, and builds packages/app first
await $`bun run script/build.ts --single --skip-install`.cwd(path.join(ROOT, "packages/opencode"))
console.log("  ✓ Binary built")

// ── Step 5: Copy frontend to XDG ────────────────────────────────────────────

console.log("\n▸ Installing frontend to XDG data dir...")
const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const frontendTarget = path.join(xdgData, "opencode", "frontend")
const frontendSource = path.join(ROOT, "packages/app/dist")

if (fs.existsSync(path.join(frontendSource, "index.html"))) {
  fs.mkdirSync(frontendTarget, { recursive: true })
  fs.cpSync(frontendSource, frontendTarget, { recursive: true })
  console.log(`  Copied to ${frontendTarget}`)
} else {
  console.warn("  ⚠ Frontend build not found — skipping XDG install")
}

// ── Step 6: Git commit & tag ─────────────────────────────────────────────────

console.log("\n▸ Committing and tagging...")
const tag = `oco-v${next}`
await $`git add -A`
await $`git commit -m ${"release: " + tag}`
await $`git tag ${tag}`
console.log(`  ✓ Committed and tagged as ${tag}`)

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`\n  ✓ Release ${next} complete!`)
console.log(`  Binary: packages/opencode/dist/@skybluejacket/oco-linux-x64/bin/oco`)
console.log(`  Frontend: ${frontendTarget}`)
console.log(`  Tag: ${tag}`)
console.log(`\n  To undo: git reset --soft HEAD~1 && git tag -d ${tag}\n`)
