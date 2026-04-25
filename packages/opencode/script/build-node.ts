#!/usr/bin/env bun

import fs from "fs"
import path from "path"
import pkg from "../package.json"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const migrationDirs = (await fs.promises.readdir(path.join(dir, "migration"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await fs.promises.readFile(file, "utf8")
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp }
  }),
)

await Bun.build({
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  target: "node",
  format: "esm",
  external: ["@lydell/node-pty", "better-sqlite3"],
  conditions: ["node"],
  sourcemap: "external",
  define: {
    OPENCODE_VERSION: `'${pkg.version}'`,
    OPENCODE_CHANNEL: "'local'",
    OPENCODE_MIGRATIONS: JSON.stringify(migrations),
  },
})

console.log("Built Node-compatible backend bundle at dist/node/node.js")
