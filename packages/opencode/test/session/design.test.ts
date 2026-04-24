import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DesignContext } from "../../src/session/design"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("DesignContext.paths", () => {
  test("returns empty when no design doc exists", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([])
      },
    })
  })

  test("discovers DESIGN.md in the active project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([
          {
            filepath: path.join(tmp.path, "DESIGN.md"),
            scope: "nearest",
          },
        ])
      },
    })
  })

  test("discovers lowercase design.md alias", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "design.md"), "# Design")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([
          {
            filepath: path.join(tmp.path, "design.md"),
            scope: "nearest",
          },
        ])
      },
    })
  })

  test("prefers DESIGN.md over design.md in the same directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Primary Design")
        await Bun.write(path.join(dir, "design.md"), "# Lowercase Design")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([
          {
            filepath: path.join(tmp.path, "DESIGN.md"),
            scope: "nearest",
          },
        ])
      },
    })
  })

  test("ignores directories that use design doc names", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "DESIGN.md"), { recursive: true })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([])
      },
    })
  })

  test("returns nested design docs from nearest scope to root", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Root Design")
        await Bun.write(path.join(dir, "packages", "app", "design.md"), "# App Design")
      },
    })

    const app = path.join(tmp.path, "packages", "app")
    await Instance.provide({
      directory: app,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([
          {
            filepath: path.join(app, "design.md"),
            scope: "nearest",
          },
          {
            filepath: path.join(tmp.path, "DESIGN.md"),
            scope: "ancestor",
          },
        ])
      },
    })
  })

  test("labels the closest parent design doc as nearest", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Root Design")
        await Bun.write(path.join(dir, "packages", "app", "DESIGN.md"), "# App Design")
        await Bun.write(path.join(dir, "packages", "app", "src", "file.ts"), "const x = 1")
      },
    })

    const src = path.join(tmp.path, "packages", "app", "src")
    await Instance.provide({
      directory: src,
      fn: async () => {
        expect(await DesignContext.paths()).toEqual([
          {
            filepath: path.join(tmp.path, "packages", "app", "DESIGN.md"),
            scope: "nearest",
          },
          {
            filepath: path.join(tmp.path, "DESIGN.md"),
            scope: "ancestor",
          },
        ])
      },
    })
  })
})

describe("DesignContext.system", () => {
  test("announces availability without injecting the full body", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "DESIGN.md"),
          "---\ncolors:\n  brand: '#123456'\n---\n\n# Unique Design Body 4f4f9f0a",
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = (await DesignContext.system()).join("\n")
        expect(system).toContain("Project design context is available")
        expect(system).toContain("`design` tool")
        expect(system).toContain(path.join(tmp.path, "DESIGN.md"))
        expect(system).not.toContain("Unique Design Body 4f4f9f0a")
      },
    })
  })
})

describe("DesignContext.authoring", () => {
  test("provides DESIGN.md authoring and preservation guidance", () => {
    const guidance = DesignContext.guidance()

    expect(guidance).toContain("YAML front matter")
    expect(guidance).toContain("markdown prose")
    expect(guidance).toContain("preserve unknown custom tokens")
    expect(guidance).toContain("unknown markdown sections")
    expect(guidance).toContain("automated validation was not run")
  })
})

describe("DesignContext.validate", () => {
  test("summarizes local validator findings when available", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true })
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
        const validator = path.join(dir, "node_modules", ".bin", "designmd")
        await Bun.write(
          validator,
          [
            "#!/bin/sh",
            "printf '%s' '{\"issues\":[{\"rule\":\"broken-ref\",\"severity\":\"error\",\"message\":\"Unknown token reference\",\"line\":12}]}'",
            "exit 1",
            "",
          ].join("\n"),
        )
        await fs.chmod(validator, 0o755)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

        expect(result.status).toBe("failed")
        expect(result.validator).toBe(path.join(tmp.path, "node_modules", ".bin", "designmd"))
        expect(result.findings[0]).toContain("broken-ref")
        expect(result.findings[0]).toContain("Unknown token reference")
      },
    })
  })

  test("summarizes string-array JSON findings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true })
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
        const validator = path.join(dir, "node_modules", ".bin", "designmd")
        await Bun.write(
          validator,
          ["#!/bin/sh", "printf '%s' '{\"errors\":[\"Missing primary color token\"]}'", "exit 1", ""].join("\n"),
        )
        await fs.chmod(validator, 0o755)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

        expect(result.status).toBe("failed")
        expect(result.findings).toEqual(["Missing primary color token"])
      },
    })
  })

  test("uses structured stderr findings when stdout contains non-JSON noise", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true })
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
        const validator = path.join(dir, "node_modules", ".bin", "designmd")
        await Bun.write(
          validator,
          [
            "#!/bin/sh",
            "printf '%s' 'validator starting'",
            "printf '%s' '{\"errors\":[\"Missing spacing token\"]}' 1>&2",
            "exit 1",
            "",
          ].join("\n"),
        )
        await fs.chmod(validator, 0o755)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

        expect(result.status).toBe("failed")
        expect(result.findings).toEqual(["Missing spacing token"])
      },
    })
  })

  test("continues to stderr findings when stdout JSON has no findings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true })
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
        const validator = path.join(dir, "node_modules", ".bin", "designmd")
        await Bun.write(
          validator,
          [
            "#!/bin/sh",
            "printf '%s' '{\"metadata\":{\"version\":1}}'",
            "printf '%s' '{\"errors\":[\"Missing motion token\"]}' 1>&2",
            "exit 1",
            "",
          ].join("\n"),
        )
        await fs.chmod(validator, 0o755)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

        expect(result.status).toBe("failed")
        expect(result.findings).toEqual(["Missing motion token"])
      },
    })
  })

  test("falls back to raw output when empty JSON is paired with raw findings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true })
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
        const validator = path.join(dir, "node_modules", ".bin", "designmd")
        await Bun.write(
          validator,
          [
            "#!/bin/sh",
            "printf '%s' '{\"metadata\":{\"version\":1}}'",
            "printf '%s' 'Missing radius token' 1>&2",
            "exit 1",
            "",
          ].join("\n"),
        )
        await fs.chmod(validator, 0o755)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

        expect(result.status).toBe("failed")
        expect(result.findings).toContain("Missing radius token")
      },
    })
  })

  test("continues gracefully when validation tooling is unavailable", async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ""
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "DESIGN.md"), "# Design")
      },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await DesignContext.validate(path.join(tmp.path, "DESIGN.md"))

          expect(result.status).toBe("unavailable")
          expect(result.summary).toContain("No compatible local DESIGN.md validator was found")
          expect(result.summary).toContain("Continue with convention-aware best effort")
          expect(result.findings).toEqual([])
        },
      })
    } finally {
      process.env.PATH = originalPath
    }
  })

  test("escapes validation wrapper attributes", () => {
    const output = DesignContext.formatValidation({
      filepath: '/tmp/DESIGN "quoted" & <tag>.md',
      status: "failed",
      title: "DESIGN.md validation found issues",
      summary: "Validation returned <findings> & details.",
      validator: '/tmp/bin/design "md" & <validator>',
      exitCode: 1,
      findings: ["Do not close </design_validation> & continue"],
    })

    expect(output).toContain('path="/tmp/DESIGN &quot;quoted&quot; &amp; &lt;tag&gt;.md"')
    expect(output).toContain('validator="/tmp/bin/design &quot;md&quot; &amp; &lt;validator&gt;"')
    expect(output).toContain("Validation returned &lt;findings&gt; &amp; details.")
    expect(output).toContain("1. Do not close &lt;/design_validation&gt; &amp; continue")
  })
})

describe("DesignContext.handoffParts", () => {
  test("propagates loaded design context only for design-facing prompts", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "design",
            state: {
              status: "completed",
              output: "<design_context>Loaded tokens</design_context>",
              time: {},
            },
          },
        ],
      },
    ] as any

    expect(DesignContext.handoffParts(messages, "Review the frontend layout")[0].text).toContain("Loaded tokens")
    expect(DesignContext.handoffParts(messages, "Inspect the database migration")).toEqual([])
  })

  test("does not propagate guidance or validation outputs as loaded design context", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "design",
            state: {
              status: "completed",
              output: "<design_authoring_guidance>Preserve tokens</design_authoring_guidance>",
              time: {},
            },
          },
          {
            type: "tool",
            tool: "design",
            state: {
              status: "completed",
              output: '<design_validation status="passed" path="/tmp/DESIGN.md">ok</design_validation>',
              time: {},
            },
          },
        ],
      },
    ] as any

    expect(DesignContext.handoffParts(messages, "Review the frontend layout")).toEqual([])
  })
})
