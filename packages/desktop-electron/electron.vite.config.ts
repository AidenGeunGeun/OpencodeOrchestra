import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import * as fs from "node:fs/promises"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const OPENCODE_SERVER_DIST = "../opencode/dist/node"
const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

export default defineConfig({
  main: {
    resolve: {
      conditions: ["node", "import", "module", "default"],
    },
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
      },
      externalizeDeps: {
        include: [nodePtyPkg],
      },
    },
    plugins: [
      {
        name: "oco:node-pty-narrower",
        enforce: "pre",
        resolveId(source) {
          if (source === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "oco:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "oco:copy-server-assets",
        async writeBundle() {
          await fs.mkdir("./out/main/chunks", { recursive: true })
          const entries = await fs.readdir(OPENCODE_SERVER_DIST).catch(() => [])
          for (const entry of entries) {
            if (!entry.endsWith(".wasm")) continue
            await fs.copyFile(`${OPENCODE_SERVER_DIST}/${entry}`, `./out/main/${entry}`)
            await fs.copyFile(`${OPENCODE_SERVER_DIST}/${entry}`, `./out/main/chunks/${entry}`)
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
          loading: "src/renderer/loading.html",
        },
      },
    },
  },
})
