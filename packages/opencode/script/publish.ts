#!/usr/bin/env bun
/**
 * ============================================================================
 * @skybluejacket/oco — Publish Script
 * ============================================================================
 *
 * Builds all 11 platform binaries and publishes 12 npm packages:
 *   - 11 platform-specific: @skybluejacket/oco-{platform}-{arch}
 *   -  1 main wrapper:      @skybluejacket/oco
 *
 * ---- PREREQUISITES ----
 *
 * 1. NPM AUTHENTICATION
 *    You need an npm Automation token (bypasses OTP for CI/scripts).
 *
 *    Create one at: https://www.npmjs.com → Access Tokens → Generate New Token → Automation
 *    Or via CLI:    npm token create --type=automation
 *
 *    Then set it as an environment variable BEFORE running this script:
 *
 *      Windows (cmd):        set NPM_TOKEN=npm_xxxxxxxxxxxx
 *      Windows (PowerShell): $env:NPM_TOKEN = "npm_xxxxxxxxxxxx"
 *      macOS/Linux:          export NPM_TOKEN=npm_xxxxxxxxxxxx
 *
 *    OR set it permanently in your user-level .npmrc:
 *
 *      npm config set //registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxx
 *
 *    Verify with: npm whoami
 *
 * 2. ROTATING / REVOKING TOKENS
 *    If a token is compromised, revoke it immediately:
 *
 *      npm token list              # find the token ID
 *      npm token revoke <token-id> # revoke it
 *
 *    Then create a new one and update your env/npmrc as above.
 *    This script never hardcodes tokens — it reads from npm's auth chain
 *    (~/.npmrc or NPM_TOKEN env var), so rotating tokens never requires
 *    code changes.
 *
 * 3. RUNNING THE PUBLISH
 *
 *      bun run script/publish.ts
 *
 *    This will: build all binaries → smoke test → pack → publish to npm.
 *    The script auto-detects preview vs. release from @opencode-ai/script.
 *
 * ============================================================================
 */
import { $ } from "bun"
import path from "path"
import fs from "fs"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

// Cross-platform recursive copy
function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  // Map process.platform to binary naming convention
  const platformMap: Record<string, string> = { win32: "windows", darwin: "darwin", linux: "linux" }
  const platform = platformMap[process.platform] || process.platform
  const name = `${pkg.name}-${platform}-${process.arch}`
  const exe = process.platform === "win32" ? "oco.exe" : "oco"
  const binPath = path.join(dir, "dist", name, "bin", exe)
  console.log(`smoke test: running ${binPath} --version`)
  if (process.platform === "win32") {
    await $`cmd /c "${binPath}" --version`
  } else {
    await $`${binPath} --version`
  }
}

// Cross-platform directory and file operations
const distPkgDir = path.join(dir, "dist", pkg.name)
fs.mkdirSync(distPkgDir, { recursive: true })
copyDir(path.join(dir, "bin"), path.join(distPkgDir, "bin"))
fs.copyFileSync(path.join(dir, "script", "postinstall.mjs"), path.join(distPkgDir, "postinstall.mjs"))

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: {
        oco: "./bin/oco",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tags = [Script.channel]
const otp = process.env.NPM_OTP?.trim()
const otpArg = otp ? `--otp=${otp}` : ""

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  for (const tag of tags) {
    await $`npm publish *.tgz --access public --tag ${tag} ${otpArg}`.cwd(`./dist/${name}`)
  }
})
await Promise.all(tasks)
await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
for (const tag of tags) {
  await $`npm publish *.tgz --access public --tag ${tag} ${otpArg}`.cwd(`./dist/${pkg.name}`)
}

if (!Script.preview) {
  // Create archives for GitHub release
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }

  const image = "ghcr.io/anomalyco/opencode"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}
