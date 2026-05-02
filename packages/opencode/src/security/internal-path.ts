// OCO-only file: shared deny policy for OCO-managed internal paths. See oco-dev skill deltas-catalog.md.
import fs from "node:fs"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"

export namespace InternalPath {
  export const roots = [
    Global.Path.data,
    Global.Path.config,
    Global.Path.cache,
    Global.Path.state,
    Global.Path.legacy.data,
    Global.Path.legacy.config,
    Global.Path.legacy.cache,
    Global.Path.legacy.state,
  ].map((item) => canonical(item))

  export function canonical(item: string) {
    const resolved = Filesystem.resolve(item)
    try {
      return Filesystem.resolve(fs.realpathSync.native(resolved))
    } catch {
      return resolved
    }
  }

  export function contains(item: string) {
    const resolved = canonical(item)
    return roots.some((root) => resolved === root || Filesystem.contains(root, resolved))
  }

  export function overlaps(item: string) {
    const resolved = canonical(item)
    return roots.some((root) => Filesystem.overlaps(root, resolved))
  }

  export function assertAllowed(item: string) {
    if (contains(item)) throw new Error("Access denied: path is managed by OCO")
  }
}
