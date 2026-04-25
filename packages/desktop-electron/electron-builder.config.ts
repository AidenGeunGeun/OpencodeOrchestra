import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (): Configuration => ({
  artifactName: "oco-electron-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*"],
  extraResources: [
    {
      from: "resources/",
      to: ".",
      filter: ["icons/**", "oco-cli*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "OpenCodeOrchestra",
    schemes: ["oco"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.opencode.orchestra.electron.dev",
        productName: "OpenCodeOrchestra Electron Dev",
        rpm: { packageName: "oco-electron-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.opencode.orchestra.electron.beta",
        productName: "OpenCodeOrchestra Electron Beta",
        protocols: { name: "OpenCodeOrchestra Electron Beta", schemes: ["oco"] },
        publish: { provider: "github", owner: "AidenGeunGeun", repo: "OpenCodeOrchestra", channel: "latest" },
        rpm: { packageName: "oco-electron-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.opencode.orchestra.electron",
        productName: "OpenCodeOrchestra Electron",
        protocols: { name: "OpenCodeOrchestra Electron", schemes: ["oco"] },
        publish: { provider: "github", owner: "AidenGeunGeun", repo: "OpenCodeOrchestra", channel: "latest" },
        rpm: { packageName: "oco-electron" },
      }
    }
  }
}

export default getConfig()
