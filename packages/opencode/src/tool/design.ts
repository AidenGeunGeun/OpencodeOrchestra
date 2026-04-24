import z from "zod"
import { Tool } from "./tool"
import { DesignContext } from "../session/design"

type DesignMetadata = {
  paths: string[]
  action?: "load" | "guidance" | "validate"
  status?: DesignContext.ValidationResult["status"]
  validator?: string
  exitCode?: number
}

export const DesignTool = Tool.define<
  z.ZodObject<{
    action: z.ZodOptional<z.ZodEnum<{ load: "load"; guidance: "guidance"; validate: "validate" }>>
    filePath: z.ZodOptional<z.ZodString>
  }>,
  DesignMetadata
>("design", async () => {
  const docs = await DesignContext.paths()
  const description =
    docs.length === 0
      ? [
          "Get DESIGN.md authoring guidance and validation support. No project design docs are available in the current project scope.",
          "Use action=guidance before creating a new DESIGN.md.",
          "Use action=validate after creating or editing a DESIGN.md when possible.",
        ].join("\n")
      : [
          "Load project DESIGN.md context, get authoring guidance, or validate a design doc on demand.",
          "Use this before UI, UX, visual, brand, motion, typography, component, layout, or user-facing copy work when project design docs are available.",
          "The loaded context preserves YAML front matter and markdown body content.",
          "When editing existing DESIGN.md files, preserve unknown custom tokens and markdown sections unless the user explicitly asks to remove them.",
          "Use action=validate after creating or editing DESIGN.md when compatible local tooling is available.",
          "Do not use this by default for unrelated backend, debug, release, provider, auth, infrastructure, or test-maintenance work.",
          "",
          "Available project design docs, ordered from nearest scope to broader ancestors:",
          "<design_docs>",
          ...docs.map((doc, index) => `  <design_doc priority="${index + 1}" scope="${doc.scope}" path="${doc.filepath}" />`),
          "</design_docs>",
        ].join("\n")

  const parameters = z.object({
    action: z.enum(["load", "guidance", "validate"]).optional().describe("What to do. Defaults to load."),
    filePath: z.string().optional().describe("Absolute path to an in-project DESIGN.md/design.md file when validating."),
  })

  return {
    description,
    parameters,
    async execute(params) {
      if (params.action === "guidance") {
        return {
          title: "DESIGN.md authoring guidance",
          output: [
            "<design_authoring_guidance>",
            DesignContext.guidance(),
            "</design_authoring_guidance>",
          ].join("\n"),
          metadata: {
            paths: docs.map((doc) => doc.filepath),
            action: "guidance",
          },
        }
      }

      if (params.action === "validate") {
        const latest = await DesignContext.paths()
        const filepath = params.filePath
          ? DesignContext.resolvePath(params.filePath)
          : (latest[0]?.filepath ?? docs[0]?.filepath)
        if (!filepath) {
          return {
            title: "DESIGN.md validation unavailable",
            output: [
              "<design_validation status=\"unavailable\">",
              "No DESIGN.md path was provided and no project design doc is available in the current project scope.",
              "Create a DESIGN.md first, then validate it. Continue best-effort using the DESIGN.md authoring guidance.",
              "</design_validation>",
            ].join("\n"),
            metadata: {
              paths: [],
              action: "validate",
              status: "unavailable",
            },
          }
        }

        if (!DesignContext.isDesignDocPath(filepath)) {
          const validation: DesignContext.ValidationResult = {
            filepath,
            status: "error",
            title: "DESIGN.md validation skipped",
            summary: "The provided validation path is not a DESIGN.md/design.md file. Choose a project design doc or create one first.",
            findings: [],
          }
          return {
            title: validation.title,
            output: DesignContext.formatValidation(validation),
            metadata: {
              paths: [filepath],
              action: "validate",
              status: validation.status,
            },
          }
        }

        if (!DesignContext.isProjectDesignDocPath(filepath)) {
          const validation: DesignContext.ValidationResult = {
            filepath,
            status: "error",
            title: "DESIGN.md validation skipped",
            summary:
              "The provided DESIGN.md validation path is outside the current project/worktree scope. Choose a project design doc or create one inside the active project first.",
            findings: [],
          }
          return {
            title: validation.title,
            output: DesignContext.formatValidation(validation),
            metadata: {
              paths: [filepath],
              action: "validate",
              status: validation.status,
            },
          }
        }

        const validation = await DesignContext.validate(filepath)
        return {
          title: validation.title,
          output: DesignContext.formatValidation(validation),
          metadata: {
            paths: [validation.filepath],
            action: "validate",
            status: validation.status,
            validator: validation.validator,
            exitCode: validation.exitCode,
          },
        }
      }

      const loaded = await DesignContext.load()
      if (loaded.length === 0) {
        return {
          title: "No design context available",
          output: "No project DESIGN.md or design.md files are available in the current project scope.",
          metadata: {
            paths: [],
          },
        }
      }

      return {
        title: loaded.length === 1 ? "Loaded design context" : `Loaded ${loaded.length} design contexts`,
        output: [
          "<design_context>",
          "Project design docs are ordered from nearest scope to broader ancestors.",
          ...loaded.flatMap((doc, index) => [
            `<design_doc priority="${index + 1}" scope="${doc.scope}" path="${doc.filepath}">`,
            doc.content,
            "</design_doc>",
          ]),
          "</design_context>",
        ].join("\n"),
        metadata: {
          paths: loaded.map((doc) => doc.filepath),
        },
      }
    },
  }
})
