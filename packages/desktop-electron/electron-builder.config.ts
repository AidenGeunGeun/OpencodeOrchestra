import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import { validatePackagedApp } from "./scripts/package-checks"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const nativeDir = path.join(packageDir, "native")
const macSigning = process.env.ELECTRON_SIGN === "true" || !!process.env.CSC_LINK || !!process.env.CSC_NAME
const macNotarize = process.env.ELECTRON_NOTARIZE === "true"
if (macNotarize && !macSigning) {
  throw new Error(
    "ELECTRON_NOTARIZE=true requires Electron macOS signing credentials (CSC_LINK/CSC_NAME or ELECTRON_SIGN=true)",
  )
}

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
    ...(existsSync(nativeDir)
      ? [
          {
            from: "native/",
            to: "native/",
            filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
          },
        ]
      : []),
  ],
  afterPack: async (context) => {
    await validatePackagedApp({ appOutDir: context.appOutDir, electronPlatformName: context.electronPlatformName })
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    identity: macSigning ? undefined : null,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: macNotarize,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: macSigning,
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
    // Required by .deb / .rpm packagers when package.json has no author.email.
    // Kept here instead of in package.json so the build config stays self-contained.
    maintainer: "OpenCodeOrchestra <noreply@opencode.orchestra>",
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
