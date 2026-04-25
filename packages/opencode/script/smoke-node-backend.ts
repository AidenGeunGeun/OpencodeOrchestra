#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const dir = path.resolve(import.meta.dirname, "..")
const bundle = path.join(dir, "dist/node/node.js")
if (!fs.existsSync(bundle)) throw new Error("Node backend bundle is missing; run bun run build:node first")

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oco-node-backend-"))
const code = `
const mod = await import(${JSON.stringify(pathToFileURL(bundle).href)});
if (!(await mod.NodeBackend.probePtyAdapter())) throw new Error("PTY adapter probe failed");
if (!(await mod.NodeBackend.probePtySpawn())) throw new Error("PTY spawn probe failed");
const listener = await mod.NodeBackend.listen({ hostname: "127.0.0.1", port: 0 });
try {
  if (listener.port === 4096) throw new Error("expected OS-assigned ephemeral port, got 4096");
  const health = await fetch(new URL("/global/health", listener.url));
  if (!health.ok) throw new Error("health status " + health.status);
  const body = await health.json();
  if (body.healthy !== true) throw new Error("health payload mismatch");
  await new Promise((resolve, reject) => {
    const url = new URL("/runtime/ws", listener.url);
    url.protocol = "ws:";
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error("websocket timeout")), 5000);
    ws.addEventListener("open", () => ws.send("adapter-ok"));
    ws.addEventListener("message", (event) => {
      clearTimeout(timeout);
      if (event.data !== "adapter-ok") reject(new Error("websocket echo mismatch"));
      ws.close();
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
} finally {
  await listener.stop(true);
}
`

await $`node --input-type=module --eval ${code}`.env({
  ...process.env,
  XDG_DATA_HOME: path.join(tmp, "data"),
  XDG_CONFIG_HOME: path.join(tmp, "config"),
  XDG_CACHE_HOME: path.join(tmp, "cache"),
  XDG_STATE_HOME: path.join(tmp, "state"),
})

console.log("Node backend smoke passed")
