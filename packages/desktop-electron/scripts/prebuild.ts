#!/usr/bin/env bun
import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveChannel, windowsify } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`

const sidecarConfig = getCurrentSidecar()
const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/oco`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline`
  : $`cd ../opencode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath)
