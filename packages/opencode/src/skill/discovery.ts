import path from "path"
import { mkdir } from "fs/promises"
import z from "zod"
import { Log } from "../util/log"
import { Global } from "../global"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })
  const Index = z.object({
    skills: z.array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        files: z.array(z.string().min(1)),
      }),
    ),
  })
  type Index = z.infer<typeof Index>

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  function isWithin(root: string, candidate: string) {
    const relative = path.relative(root, candidate)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }

  function normalizeSkillName(name: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return
    if (name === "." || name === "..") return
    return name
  }

  function normalizeSkillFile(file: string) {
    if (file.includes("\0")) return
    if (file.startsWith("/") || file.startsWith("\\")) return
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file)) return

    const normalized = path.posix.normalize(file.replaceAll("\\", "/"))
    if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return
    return normalized
  }

  async function get(url: string, dest: string): Promise<boolean> {
    if (await Bun.file(dest).exists()) return true
    return fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to download", { url, status: response.status })
          return false
        }
        await Bun.write(dest, await response.text())
        return true
      })
      .catch((err) => {
        log.error("failed to download", { url, err })
        return false
      })
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const baseURL = new URL(base)
    const index = new URL("index.json", baseURL).href
    const cache = dir()

    log.info("fetching index", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response.json().catch((err) => {
          log.error("failed to parse index", { url: index, err })
          return undefined
        })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    const parsed = Index.safeParse(data)
    if (!parsed.success) {
      log.warn("invalid index format", {
        url: index,
        issues: parsed.error.issues.map((issue) => issue.message),
      })
      return result
    }

    const list = parsed.data.skills

    await Promise.all(
      list.map(async (skill) => {
        const name = normalizeSkillName(skill.name)
        if (!name) {
          log.warn("invalid skill name", { url: index, name: skill.name })
          return
        }

        const root = path.join(cache, name)
        if (!isWithin(cache, root)) {
          log.warn("skill name escapes cache root", { url: index, name })
          return
        }
        const skillBase = new URL(`${name}/`, baseURL)

        await Promise.all(
          skill.files.map(async (file) => {
            const safeFile = normalizeSkillFile(file)
            if (!safeFile) {
              log.warn("invalid skill file path", { url: index, skill: name, file })
              return
            }

            const link = new URL(safeFile, skillBase)
            if (link.origin !== skillBase.origin || !link.pathname.startsWith(skillBase.pathname)) {
              log.warn("invalid skill file url", { url: index, skill: name, file: safeFile, link: link.href })
              return
            }

            const dest = path.resolve(root, safeFile)
            if (!isWithin(root, dest)) {
              log.warn("skill file escapes destination", { url: index, skill: name, file: safeFile })
              return
            }

            await mkdir(path.dirname(dest), { recursive: true })
            await get(link.href, dest)
          }),
        )

        const md = path.join(root, "SKILL.md")
        if (await Bun.file(md).exists()) result.push(root)
      }),
    )

    return result
  }
}
