import { $ } from "bun"

export const SIDECAR_NAME = "oco"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "@skybluejacket/oco-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "@skybluejacket/oco-darwin-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    ocBinary: "@skybluejacket/oco-windows-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "@skybluejacket/oco-windows-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "@skybluejacket/oco-linux-x64-baseline",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "@skybluejacket/oco-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function detectRustTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin"
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin"
  if (process.platform === "win32" && process.arch === "arm64") return "aarch64-pc-windows-msvc"
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc"
  if (process.platform === "linux" && process.arch === "arm64") return "aarch64-unknown-linux-gnu"
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-gnu"
}

export function getCurrentSidecar(target = RUST_TARGET) {
  const resolvedTarget = target ?? Bun.env.TAURI_ENV_TARGET_TRIPLE ?? detectRustTarget()
  if (!resolvedTarget) throw new Error("Unable to determine the Rust target for desktop sidecar staging")

  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === resolvedTarget)
  if (!binaryConfig) {
    throw new Error(`Sidecar configuration not available for Rust target '${resolvedTarget}'`)
  }

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  const resolvedTarget = target ?? Bun.env.TAURI_ENV_TARGET_TRIPLE ?? detectRustTarget()
  if (!resolvedTarget) throw new Error("Unable to determine the Rust target for desktop sidecar staging")

  await $`mkdir -p src-tauri/sidecars`
  const dest = windowsify(`src-tauri/sidecars/${SIDECAR_NAME}-${resolvedTarget}`)
  await $`cp ${source} ${dest}`

  console.log(`Copied ${source} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
