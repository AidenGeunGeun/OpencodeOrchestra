#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const tag = `oco-v${Script.version}`

if (!Script.preview) {
  await $`gh release edit ${tag} --draft=false`
}

await $`bun install`

await $`gh release download --pattern "opencode-linux-*64.tar.gz" --pattern "opencode-darwin-*64.zip" -D dist`

await import(`../packages/opencode/script/publish-registries.ts`)
