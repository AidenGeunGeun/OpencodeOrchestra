import { sep } from "node:path"

export namespace FileIgnore {
  // OCO: exported so Ripgrep.files() can apply the same exclusion list as
  // the file watcher. Without this, scanning the parent of a monorepo (no
  // .gitignore at the root) pulls in every node_modules path beneath every
  // subproject — observed 387k files for a project root containing nested
  // OpenCodeOrchestra + tools + pathtent. The 387k-line stream saturates
  // the JS event loop and stalls concurrent HTTP requests for ~60s.
  export const FOLDERS = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",
  ]

  const FILE_GLOBS = FILES.map((p) => new Bun.Glob(p))

  export const PATTERNS = [...FILES, ...FOLDERS]

  export function match(
    filepath: string,
    opts?: {
      extra?: Bun.Glob[]
      whitelist?: Bun.Glob[]
    },
  ) {
    for (const glob of opts?.whitelist || []) {
      if (glob.match(filepath)) return false
    }

    // Normalize to forward slashes for cross-platform matching
    const normalized = filepath.replaceAll("\\", "/")
    const parts = normalized.split("/")
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    const extra = opts?.extra || []
    for (const glob of [...FILE_GLOBS, ...extra]) {
      if (glob.match(filepath)) return true
    }

    return false
  }
}
