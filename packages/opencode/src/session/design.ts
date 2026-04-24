import fs from "fs/promises"
import { constants } from "fs"
import path from "path"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import type { MessageV2 } from "./message-v2"

const FILES = ["DESIGN.md", "design.md"]
const VALIDATOR_BINS = ["designmd", "design.md"]
const MAX_FINDINGS = 12
const VALIDATION_TIMEOUT = 10_000
const DESIGN_FACING = [
  "ui",
  "ux",
  "visual",
  "frontend",
  "front-end",
  "design",
  "brand",
  "motion",
  "typography",
  "color",
  "spacing",
  "layout",
  "component",
  "microcopy",
  "user-facing copy",
  "voice",
  "tone",
]

export namespace DesignContext {
  export type Doc = {
    filepath: string
    scope: "nearest" | "ancestor"
  }

  export type LoadedDoc = Doc & {
    content: string
  }

  export type ValidationResult = {
    filepath: string
    status: "passed" | "failed" | "unavailable" | "error"
    title: string
    summary: string
    validator?: string
    exitCode?: number
    findings: string[]
  }

  async function find(dir: string) {
    const entries = await fs.readdir(dir).catch((): string[] => [])
    for (const file of FILES) {
      if (!entries.includes(file)) continue
      const filepath = path.resolve(dir, file)
      const stats = await fs.stat(filepath).catch(() => undefined)
      if (stats?.isFile()) return filepath
    }
  }

  function boundary() {
    return path.resolve(Instance.project.vcs === "git" ? Instance.worktree : Instance.directory)
  }

  function within(candidate: string, root: string) {
    const relative = path.relative(root, candidate)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }

  function executable(file: string) {
    return fs.access(file, constants.X_OK).then(
      () => true,
      () => false,
    )
  }

  async function validator() {
    const root = boundary()
    const local: string[] = []
    let current = path.resolve(Instance.directory)
    while (within(current, root)) {
      for (const bin of VALIDATOR_BINS) local.push(path.join(current, "node_modules", ".bin", bin))
      if (current === root) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }

    const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? []
    const candidates = [...local, ...paths.flatMap((entry) => VALIDATOR_BINS.map((bin) => path.join(entry, bin)))]
    for (const candidate of candidates) {
      if (await executable(candidate)) return candidate
    }
  }

  function text(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }

  function collect(value: unknown): string[] {
    const scalar = text(value)
    if (scalar) return [scalar]
    if (!value || typeof value !== "object") return []
    if (Array.isArray(value)) return value.flatMap(collect)

    const record = value as Record<string, unknown>
    const message = text(record.message) ?? text(record.description) ?? text(record.detail) ?? text(record.title)
    const rule = text(record.rule) ?? text(record.ruleId) ?? text(record.rule_id) ?? text(record.code) ?? text(record.id)
    const severity = text(record.severity) ?? text(record.level) ?? text(record.type)
    const line = text(record.line) ?? text(record.startLine) ?? text((record.position as Record<string, unknown> | undefined)?.line)
    const prefix = [severity, rule].filter(Boolean).join(" ")
    const location = line ? `line ${line}` : undefined
    const finding = message ? [prefix, location, message].filter(Boolean).join(": ") : undefined

    const nested = [
      record.issues,
      record.findings,
      record.diagnostics,
      record.results,
      record.messages,
      record.errors,
      record.warnings,
    ].flatMap(collect)

    return finding ? [finding, ...nested] : nested
  }

  function summarizeRaw(output: string) {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_FINDINGS)
  }

  function parseFindings(...outputs: string[]): string[] | undefined {
    let parsedEmpty = false
    let unparsed = false
    for (const output of outputs) {
      const trimmed = output.trim()
      if (!trimmed) continue
      try {
        const findings = collect(JSON.parse(trimmed))
        if (findings.length > 0) return findings
        parsedEmpty = true
      } catch {
        unparsed = true
      }
    }
    if (unparsed) return undefined
    return parsedEmpty ? [] : undefined
  }

  function escapeText(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  }

  function escapeAttribute(value: string) {
    return escapeText(value).replaceAll('"', "&quot;")
  }

  export function isDesignDocPath(filepath: string) {
    return FILES.includes(path.basename(filepath))
  }

  export function resolvePath(filepath: string) {
    return path.resolve(path.isAbsolute(filepath) ? filepath : path.join(Instance.directory, filepath))
  }

  export function isProjectDesignDocPath(filepath: string) {
    const resolved = resolvePath(filepath)
    return isDesignDocPath(resolved) && within(resolved, boundary())
  }

  export function guidance() {
    return [
      "DESIGN.md is an alpha Google Labs convention for plain-text design-system context.",
      "Use optional YAML front matter for machine-readable, normative design tokens when tokens are known; use markdown prose to explain how people and agents should apply them.",
      "Common token areas include color, typography, spacing, shape, motion, and component-level decisions, but project intent matters more than maximizing schema coverage.",
      "When editing an existing DESIGN.md, preserve unknown custom tokens, custom front-matter fields, and unknown markdown sections unless the user explicitly asks to remove or rename them.",
      "Prefer targeted edits over rewrites. Keep project-specific rationale, examples, exceptions, and brand voice intact by default.",
      "Duplicate recognized sections, broken token references, missing primary tokens, contrast problems, and section-order drift are useful quality checks when validation tooling is available.",
      "If compatible local validation tooling is unavailable or changes behavior, continue best-effort and clearly state that automated validation was not run.",
    ].join("\n")
  }

  export async function paths(): Promise<Doc[]> {
    if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return []

    const root = boundary()
    const result: Doc[] = []
    let current = path.resolve(Instance.directory)

    while (within(current, root)) {
      const filepath = await find(current)
      if (filepath) {
        result.push({
          filepath,
          scope: result.length === 0 ? "nearest" : "ancestor",
        })
      }

      if (current === root) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }

    return result
  }

  export async function system() {
    const docs = await paths()
    if (docs.length === 0) return []

    return [
      [
        "Project design context is available but not loaded.",
        "Use the `design` tool to load the full DESIGN.md context before UI, UX, visual, brand, motion, typography, component, layout, or user-facing copy work.",
        "Do not load it by default for unrelated backend, debug, release, provider, auth, infrastructure, or test-maintenance work.",
        "If AGENTS.md and DESIGN.md conflict, AGENTS.md controls agent operating rules and DESIGN.md controls visual/product intent.",
        "<design_docs>",
        ...docs.map((doc, index) => `  <design_doc priority="${index + 1}" scope="${doc.scope}" path="${doc.filepath}" />`),
        "</design_docs>",
      ].join("\n"),
    ]
  }

  export async function load(): Promise<LoadedDoc[]> {
    const docs = await paths()
    return Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        content: await Bun.file(doc.filepath)
          .text()
          .catch(() => undefined),
      })),
    ).then((items) => items.filter((item): item is LoadedDoc => item.content !== undefined))
  }

  export async function validate(filepath: string): Promise<ValidationResult> {
    const resolved = resolvePath(filepath)
    const available = await Bun.file(resolved).exists()
    if (!available) {
      return {
        filepath: resolved,
        status: "error",
        title: "DESIGN.md validation skipped",
        summary: `Cannot validate because the file does not exist: ${resolved}`,
        findings: [`Create the file first, then run DESIGN.md validation again.`],
      }
    }

    const bin = await validator()
    if (!bin) {
      return {
        filepath: resolved,
        status: "unavailable",
        title: "DESIGN.md validation unavailable",
        summary: [
          "No compatible local DESIGN.md validator was found.",
          "Install @google/design.md locally or add a designmd/design.md executable to PATH to enable automated linting.",
          "Continue with convention-aware best effort and preserve unknown custom tokens and sections.",
        ].join(" "),
        findings: [],
      }
    }

    const proc = (() => {
      try {
        return Bun.spawn([bin, "lint", resolved], {
          cwd: Instance.directory,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        })
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error))
      }
    })()
    if (proc instanceof Error) {
      return {
        filepath: resolved,
        status: "error",
        title: "DESIGN.md validation could not start",
        summary: `Compatible local DESIGN.md validation could not start: ${proc.message}`,
        validator: bin,
        findings: ["Continue best-effort and rerun validation manually after checking the local validator install."],
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).catch(
      (error) => ["", error instanceof Error ? error.message : String(error), -1] as const,
    )
    const result = await Promise.race([
      completed,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          proc.kill("SIGKILL")
          resolve("timeout")
        }, VALIDATION_TIMEOUT)
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    if (result === "timeout") {
      return {
        filepath: resolved,
        status: "error",
        title: "DESIGN.md validation timed out",
        summary: `Compatible local DESIGN.md validation exceeded ${VALIDATION_TIMEOUT / 1000}s and was stopped. Continue best-effort instead of blocking authoring.`,
        validator: bin,
        findings: ["The local validator did not finish in time; rerun it manually if deeper lint detail is needed."],
      }
    }
    const [stdout, stderr, exitCode] = result
    const combined = [stdout, stderr].filter((part) => part.trim()).join("\n")
    const findings = (parseFindings(stdout, stderr) ?? summarizeRaw(combined)).slice(0, MAX_FINDINGS)

    if (exitCode === 0) {
      return {
        filepath: resolved,
        status: "passed",
        title: "DESIGN.md validation passed",
        summary: findings.length
          ? "Compatible local DESIGN.md validation passed with informational findings."
          : "Compatible local DESIGN.md validation passed with no findings.",
        validator: bin,
        exitCode,
        findings,
      }
    }

    return {
      filepath: resolved,
      status: exitCode === 1 ? "failed" : "error",
      title: exitCode === 1 ? "DESIGN.md validation found issues" : "DESIGN.md validation could not complete",
      summary:
        findings.length > 0
          ? "Compatible local DESIGN.md validation returned actionable findings."
          : `Compatible local DESIGN.md validation exited with code ${exitCode}, but did not return parseable findings.`,
      validator: bin,
      exitCode,
      findings,
    }
  }

  export function formatValidation(result: ValidationResult) {
    const attrs = [
      `status="${escapeAttribute(result.status)}"`,
      `path="${escapeAttribute(result.filepath)}"`,
      ...(result.validator ? [`validator="${escapeAttribute(result.validator)}"`] : []),
    ].join(" ")
    return [
      `<design_validation ${attrs}>`,
      escapeText(result.summary),
      ...(result.findings.length > 0 ? ["", ...result.findings.map((finding, index) => `${index + 1}. ${escapeText(finding)}`)] : []),
      "</design_validation>",
    ].join("\n")
  }

  export function loaded(messages: MessageV2.WithParts[]) {
    const result: string[] = []
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "design") continue
        if (part.state.status !== "completed") continue
        if (part.state.time.compacted) continue
        const output = part.state.output.trim()
        if (!output) continue
        if (!output.startsWith("<design_context")) continue
        result.push(output)
      }
    }
    return result
  }

  export function isDesignFacing(text: string) {
    const normalized = text.toLowerCase()
    return DESIGN_FACING.some((word) => normalized.includes(word))
  }

  export function handoffParts(messages: MessageV2.WithParts[] | undefined, prompt: string): Array<{ type: "text"; text: string }> {
    if (!messages || !isDesignFacing(prompt)) return []
    const contexts = loaded(messages)
    if (contexts.length === 0) return []

    return [
      {
        type: "text",
        text: [
          "<project_design_context>",
          "The parent agent loaded this project design context before delegating the design-facing task.",
          "Use it as visual/product design guidance unless the user explicitly instructed otherwise.",
          "",
          ...contexts,
          "</project_design_context>",
        ].join("\n"),
      },
    ]
  }
}
