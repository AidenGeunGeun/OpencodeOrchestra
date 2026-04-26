import { $ } from "bun"

await $`bun run --cwd ../opencode build:node`
await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`
