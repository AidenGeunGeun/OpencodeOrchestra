#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"

const sectionOrder = ["Features", "Fixes", "Performance", "Refactors", "Docs", "Chores"] as const
const sectionByType = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  refactor: "Refactors",
  docs: "Docs",
  chore: "Chores",
  ci: "Chores",
  build: "Chores",
  style: "Chores",
  test: "Chores",
} as const

type Section = (typeof sectionOrder)[number]
type Entry = { message: string; scope?: string; shortHash: string; url: string }

function stripTagPrefix(tag: string) {
  return tag.replace(/^oco-v/, "")
}

function commitLink(entry: Entry) {
  return `([${entry.shortHash}](${entry.url}))`
}

function parseRepo(remote: string) {
  const normalized = remote.trim().replace(/^git@github\.com:/, "https://github.com/")
  const match = normalized.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/)
  if (!match) throw new Error(`Could not parse GitHub repository from remote: ${remote}`)
  return match[1]
}

async function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const remote = await $`git remote get-url origin`.text()
  return parseRepo(remote)
}

async function defaultCurrent() {
  const pkg = await Bun.file(new URL("../packages/opencode/package.json", import.meta.url)).json()
  return `oco-v${pkg.version}`
}

async function defaultPrevious(current: string) {
  const target = current === "HEAD" ? "HEAD^" : `${current}^`
  return (await $`git describe --tags --abbrev=0 ${target}`.text()).trim()
}

function renderScopeSection(lines: string[], entries: Entry[]) {
  const grouped = Map.groupBy(entries, (entry) => entry.scope ?? "misc")
  const scopes = [...grouped.keys()].filter((scope) => scope !== "misc").toSorted()
  if (grouped.has("misc")) scopes.push("misc")
  for (const scope of scopes) {
    lines.push(`**${scope}**`)
    for (const entry of grouped.get(scope) ?? []) {
      lines.push(`- ${entry.message} ${commitLink(entry)}`)
    }
    lines.push("")
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      previous: { type: "string" },
      current: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", default: false },
    },
  })

  if (values.help) {
    console.log(`Usage: bun run script/release-notes.ts [--previous <tag>] [--current <tag>] [--output <path>]`)
    return
  }

  const current = values.current ?? (await defaultCurrent())
  const previous = values.previous ?? (await defaultPrevious(current))
  const repo = await repository()
  const compareUrl = `https://github.com/${repo}/compare/${previous}...${current}`
  const commits = (await $`git log --reverse --pretty=format:%H%x1f%s ${previous}..${current}`.text())
    .trim()
    .split("\n")
    .filter(Boolean)

  const grouped = new Map<Section, Entry[]>()
  const other: Entry[] = []
  for (const line of commits) {
    const [hash, subject] = line.split("\x1f")
    if (!hash || !subject) continue
    const entry = { shortHash: hash.slice(0, 7), url: `https://github.com/${repo}/commit/${hash}` }
    const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/)
    if (!match) {
      other.push({ ...entry, message: subject })
      continue
    }

    const section = sectionByType[match[1] as keyof typeof sectionByType]
    if (!section) {
      other.push({ ...entry, message: subject })
      continue
    }

    const next = grouped.get(section) ?? []
    next.push({ ...entry, message: match[4] ?? subject, scope: match[2] })
    grouped.set(section, next)
  }

  const lines = [`## OpenCodeOrchestra v${stripTagPrefix(current)}`, ""]
  for (const section of sectionOrder) {
    const entries = grouped.get(section)
    if (!entries?.length) continue
    lines.push(`### ${section}`, "")
    if (section === "Docs") {
      for (const entry of entries) {
        lines.push(`- ${entry.message} ${commitLink(entry)}`)
      }
      lines.push("")
      continue
    }
    renderScopeSection(lines, entries)
  }

  if (other.length) {
    lines.push("### Other", "")
    for (const entry of other) {
      lines.push(`- ${entry.message} ${commitLink(entry)}`)
    }
    lines.push("")
  }

  while (lines.at(-1) === "") lines.pop()
  lines.push("", `**Full Changelog**: ${compareUrl}`)
  const output = `${lines.join("\n")}\n`
  if (values.output) {
    await Bun.write(values.output, output)
    return
  }
  process.stdout.write(output)
}

await main()
