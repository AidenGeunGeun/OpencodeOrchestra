// OCO-only file: shared deny policy for OCO-managed internal paths. See oco-dev skill deltas-catalog.md.
import fs from "node:fs"
import path from "node:path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

export namespace InternalPath {
  const directSecretFiles = [
    path.join(Global.Path.data, "auth.json"),
    path.join(Global.Path.data, "mcp-auth.json"),
    path.join(Global.Path.data, "secret-vault.key"),
    path.join(Global.Path.legacy.data, "auth.json"),
    path.join(Global.Path.legacy.data, "mcp-auth.json"),
    path.join(Global.Path.legacy.data, "secret-vault.key"),
  ]

  const rawPrivateDirs = [
    path.join(Global.Path.data, "storage"),
    path.join(Global.Path.data, "tool-output"),
    path.join(Global.Path.data, "snapshot"),
    path.join(Global.Path.data, "snapshots"),
    path.join(Global.Path.data, "worktree"),
    path.join(Global.Path.legacy.data, "storage"),
    path.join(Global.Path.legacy.data, "tool-output"),
    path.join(Global.Path.legacy.data, "snapshot"),
    path.join(Global.Path.legacy.data, "snapshots"),
    path.join(Global.Path.legacy.data, "worktree"),
  ]

  export const roots = [...directSecretFiles, ...rawPrivateDirs]

  export function canonical(item: string, seen = new Set<string>()) {
    const resolved = Filesystem.resolve(item)
    try {
      return Filesystem.resolve(fs.realpathSync.native(resolved))
    } catch {
    }

    const parsed = path.parse(resolved)
    const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
    let current = parsed.root

    for (let i = 0; i < parts.length; i++) {
      const candidate = path.join(current, parts[i])
      let stat: ReturnType<typeof fs.lstatSync>
      try {
        stat = fs.lstatSync(candidate)
      } catch {
        current = candidate
        continue
      }

      if (!stat.isSymbolicLink()) {
        current = candidate
        continue
      }

      if (seen.has(candidate)) return resolved
      seen.add(candidate)

      const link = fs.readlinkSync(candidate)
      const target = path.isAbsolute(link) ? link : path.resolve(path.dirname(candidate), link)
      return canonical(path.join(target, ...parts.slice(i + 1)), seen)
    }

    return resolved
  }

  export function contains(item: string) {
    const lexical = Filesystem.resolve(item)
    const resolved = canonical(item)
    return roots.some((root) => {
      const deniedLexical = Filesystem.resolve(root)
      const denied = canonical(root)
      return (
        containsPath(deniedLexical, lexical) ||
        containsPath(deniedLexical, resolved) ||
        containsPath(denied, lexical) ||
        containsPath(denied, resolved)
      )
    })
  }

  function containsPath(parent: string, child: string) {
    const relative = path.relative(parent, child)
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  }

  export function overlaps(item: string) {
    return contains(item)
  }

  export function assertAllowed(item: string) {
    if (contains(item)) throw new Error("Access denied: protected OCO internal path")
  }
}
