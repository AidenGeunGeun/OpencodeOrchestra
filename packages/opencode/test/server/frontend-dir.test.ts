import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Glob } from "bun"
import { Global } from "../../src/global"
import { Server } from "../../src/server/server"

// `~/.local/share/oco/frontend` used to be picked up automatically by `Server.resolveFrontendDir()`.
// That fallback caused stale frontend assets from older installs to silently override
// fresher packaged/monorepo paths. These tests pin the new behavior: XDG is never used
// without an explicit env override, and the helper still exposes the path so the CLI can
// warn loudly when a stale bundle is present.
//
// SAFETY: the suite writes and removes a fake frontend bundle under `<XDG_DATA_HOME>/oco/
// frontend`. The repository test preload (`packages/opencode/test/preload.ts`) pins
// `XDG_DATA_HOME` to a per-PID temp directory under `os.tmpdir()`, so `Global.Path.data`
// resolves inside that sandbox. We refuse to touch the path otherwise — the assertion
// below makes the safety boundary explicit and fails closed if a future preload change
// ever leaves `Global.Path.data` pointing at a real user directory.
const xdgFrontend = path.join(Global.Path.data, "frontend")
const tmpRoot = fs.realpathSync(os.tmpdir())

let workdir: string
let originalEnv: string | undefined

function writeFakeFrontend(dir: string, marker: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta name="oco-frontend-marker" content="${marker}">`)
}

function isInsideTmp(target: string): boolean {
  // Resolve symlinks and normalize so prefix-sibling paths cannot satisfy this check.
  // For example `/tmp/oco` must not match `/tmp/oco-real/...`. We require a strict path
  // boundary by comparing the segment relation, not raw string prefixes.
  const resolved = fs.realpathSync.native(target)
  if (resolved === tmpRoot) return true
  const rel = path.relative(tmpRoot, resolved)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

beforeAll(() => {
  // Fail closed if `Global.Path.data` is not isolated inside the OS temp area. This stops
  // the suite from ever deleting a real user's `~/.local/share/oco/frontend` bundle if a
  // future preload regression weakens the sandbox.
  const dataDir = path.dirname(path.resolve(xdgFrontend))
  if (!isInsideTmp(dataDir)) {
    const resolvedData = fs.realpathSync.native(dataDir)
    throw new Error(
      `Refusing to run frontend-dir tests: Global.Path.data is not isolated (${resolvedData}). ` +
        `Run tests through the repository preload that pins XDG_DATA_HOME to a temp directory.`,
    )
  }
})

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "oco-frontend-dir-test-"))
  originalEnv = process.env.OPENCODE_FRONTEND_DIR
  delete process.env.OPENCODE_FRONTEND_DIR
  // Make sure no prior test left a frontend bundle behind in the (already-isolated) XDG
  // path. The realpath check in beforeAll guards against this targeting a real directory.
  fs.rmSync(xdgFrontend, { recursive: true, force: true })
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OPENCODE_FRONTEND_DIR
  else process.env.OPENCODE_FRONTEND_DIR = originalEnv
  fs.rmSync(workdir, { recursive: true, force: true })
  fs.rmSync(xdgFrontend, { recursive: true, force: true })
})

describe("Server.resolveFrontendDir", () => {
  test("explicit OPENCODE_FRONTEND_DIR wins over every other path", () => {
    const explicitDir = path.join(workdir, "explicit")
    writeFakeFrontend(explicitDir, "explicit")
    process.env.OPENCODE_FRONTEND_DIR = explicitDir

    const resolved = Server.resolveFrontendDir()

    expect(resolved).toBe(explicitDir)
  })

  test("a stale XDG frontend bundle is not auto-resolved without the explicit env override", () => {
    // Older installs dropped frontend assets under `<xdg-data>/oco/frontend`. Build a
    // matching layout here. The helper must return either the binary-relative or the
    // monorepo dev path (when present) or null. The XDG path must never be the resolved
    // directory unless the caller asks for it explicitly via OPENCODE_FRONTEND_DIR.
    writeFakeFrontend(xdgFrontend, "stale-xdg")

    const resolved = Server.resolveFrontendDir()

    expect(resolved).not.toBe(xdgFrontend)
  })

  test("legacyXdgFrontendDir exposes the stale path so the CLI can warn the user", () => {
    expect(Server.legacyXdgFrontendDir()).toBeNull()

    writeFakeFrontend(xdgFrontend, "stale-xdg")

    expect(Server.legacyXdgFrontendDir()).toBe(xdgFrontend)
  })

  test("explicit override still serves a user-pinned XDG bundle when requested", () => {
    writeFakeFrontend(xdgFrontend, "stale-xdg")
    process.env.OPENCODE_FRONTEND_DIR = xdgFrontend

    expect(Server.resolveFrontendDir()).toBe(xdgFrontend)
  })
})

describe("Server.App served Analytics asset freshness", () => {
  // If `packages/app/dist/` has been built, the monorepo-relative path resolves to it and
  // the Hono catch-all route serves its assets. This test fetches the actual Analytics
  // chunk through the request pipeline so we know the live server delivers current UI
  // markers, not just that the dist directory contains them. When dist is absent (a fresh
  // workspace clone without a build) the test is a no-op.
  test("the served Analytics chunk carries current no-flicker markers when dist is built", async () => {
    const distDir = path.join(__dirname, "..", "..", "..", "app", "dist")
    if (!fs.existsSync(path.join(distDir, "index.html"))) return

    const previousFrontend = process.env.OPENCODE_FRONTEND_DIR
    process.env.OPENCODE_FRONTEND_DIR = distDir
    try {
      const assetsDir = path.join(distDir, "assets")
      const glob = new Glob("analytics-*.js")
      const matches: string[] = []
      for await (const f of glob.scan({ cwd: assetsDir })) matches.push(f)
      if (matches.length === 0) return

      const chunkPath = `/assets/${matches[0]!}`
      const response = await Server.App().request(chunkPath)
      expect(response.status).toBe(200)
      const body = await response.text()

      // Current Analytics labels that must be present.
      expect(body).toContain("Model calls")
      expect(body).toContain("Catching up local history")
      expect(body).toContain("Dashboard stays live")
      expect(body).toContain("Rebuild in progress")
      expect(body).toContain("data-analytics-dashboard")

      // Legacy strip behavior that must be absent.
      expect(body).not.toContain("Refreshing local history")
      expect(body).not.toMatch(/RefreshProgressStrip/)
    } finally {
      if (previousFrontend === undefined) delete process.env.OPENCODE_FRONTEND_DIR
      else process.env.OPENCODE_FRONTEND_DIR = previousFrontend
    }
  })
})
