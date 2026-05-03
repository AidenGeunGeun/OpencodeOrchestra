import path from "path"
import { pathToFileURL } from "url"
import * as fs from "fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { PermissionNext } from "../permission/next"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"
import { Filesystem } from "@/util/filesystem"

const MAX_RESOURCE_BYTES = 100 * 1024

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
           "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
           "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "To load a bundled resource after loading a skill, call this tool again with the same skill name and a relative `resource` path from the skill output or SKILL.md links.",
           "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `    <location>${pathToFileURL(skill.location).href}</location>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join("\n")

  const examples = accessibleSkills
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().describe(`The name of the skill from available_skills${hint}`),
    resource: z
      .string()
      .optional()
      .describe(
        "Optional relative path to a bundled skill resource to load, such as references/guide.md or scripts/example.sh",
      ),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((skill) => skill.name).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      if (params.resource) {
        const resource = await resolveResourcePath(dir, params.resource)
        const file = Bun.file(resource)
        const stat = await file.stat().catch(() => undefined)
        if (!stat) throw new Error(`Skill resource not found: ${params.resource}`)
        if (stat.isDirectory()) throw new Error(`Skill resource is a directory: ${params.resource}`)
        if (stat.size > MAX_RESOURCE_BYTES) {
          throw new Error(`Skill resource is too large: ${params.resource} (${stat.size} bytes)`)
        }

        const content = await fs.readFile(resource, "utf8")
        const relative = path.relative(dir, resource).split(path.sep).join("/")
        return {
          title: `Loaded skill resource: ${skill.name}/${relative}`,
          output: [
            `<skill_resource name="${skill.name}" path="${relative}">`,
            content.trimEnd(),
            `</skill_resource>`,
          ].join("\n"),
          metadata: {
            name: skill.name,
            dir,
            resource: relative as string | undefined,
          },
        }
      }

      const limit = 10
      const files = await iife(async () => {
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Load bundled resources by calling this skill tool again with `resource` set to a relative path.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          dir,
          resource: undefined as string | undefined,
        },
      }
    },
  }
})

async function resolveResourcePath(dir: string, resource: string) {
  if (path.isAbsolute(resource)) throw new Error("Skill resource path must be relative")
  const normalized = resource.replaceAll("\\", "/")
  const target = path.resolve(dir, normalized)

  const lexicalDir = Filesystem.resolve(dir)
  const lexicalTarget = Filesystem.resolve(target)
  if (lexicalTarget === lexicalDir || !Filesystem.contains(lexicalDir, lexicalTarget)) {
    throw new Error("Skill resource path escapes skill directory")
  }

  const canonicalDir = await fs.realpath(dir).catch(() => lexicalDir)
  const canonicalTarget = await fs.realpath(target).catch(() => lexicalTarget)
  if (canonicalTarget === canonicalDir || !Filesystem.contains(canonicalDir, canonicalTarget)) {
    throw new Error("Skill resource path escapes skill directory")
  }

  return target
}
