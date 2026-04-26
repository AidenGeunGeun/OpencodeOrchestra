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
const project = fs.mkdtempSync(path.join(tmp, "project-"))
const electronRuntime = (() => {
  if (process.platform === "darwin") {
    const binary = path.resolve(
      dir,
      "../desktop-electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    )
    if (fs.existsSync(binary)) return binary
  }
  if (process.platform === "win32") {
    const binary = path.resolve(dir, "../desktop-electron/node_modules/electron/dist/electron.exe")
    if (fs.existsSync(binary)) return binary
  }
  const binary = path.resolve(dir, "../desktop-electron/node_modules/electron/dist/electron")
  if (fs.existsSync(binary)) return binary
  return undefined
})()
const code = `
const mod = await import(${JSON.stringify(pathToFileURL(bundle).href)});
if (!(await mod.NodeBackend.probePtyAdapter())) throw new Error("PTY adapter probe failed");
if (!(await mod.NodeBackend.probePtySpawn())) throw new Error("PTY spawn probe failed");
const listener = await mod.NodeBackend.listen({ hostname: "127.0.0.1", port: 0 });
try {
  if (listener.port === 4096) throw new Error("expected OS-assigned ephemeral port, got 4096");
  const auth = "Basic " + Buffer.from("oco:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
  const headers = { "x-opencode-directory": process.env.OCO_SMOKE_PROJECT, authorization: auth };
  const health = await fetch(new URL("/global/health", listener.url), { headers });
  if (!health.ok) throw new Error("health status " + health.status);
  const body = await health.json();
  if (body.healthy !== true) throw new Error("health payload mismatch");
  const sessionsRes = await fetch(new URL("/session", listener.url), { headers });
  if (!sessionsRes.ok) throw new Error("session listing status " + sessionsRes.status + " " + await sessionsRes.text());
  const sessions = await sessionsRes.json();
  if (!Array.isArray(sessions)) throw new Error("session listing payload mismatch");
  const pty = await fetch(new URL("/pty", listener.url), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      command: process.execPath,
      args: ["-e", "process.stdout.write('pty-route-ok'); setTimeout(() => {}, 2000)"],
      cwd: process.env.OCO_SMOKE_PROJECT,
      title: "Smoke PTY"
    }),
  });
  if (!pty.ok) throw new Error("pty create status " + pty.status + " " + await pty.text());
  const ptyInfo = await pty.json();
  // Exercise the Bun.Glob shim via routes that use scanSync (tools registry), scan
  // (agents / skills / commands), and Glob.match (file ignore). These all need to
  // succeed for the in-process backend to serve real flows, not just the smoke probes.
  const agentsRes = await fetch(new URL("/agent", listener.url), { headers });
  if (!agentsRes.ok) throw new Error("agent listing status " + agentsRes.status);
  const agents = await agentsRes.json();
  if (!Array.isArray(agents) || agents.length === 0) throw new Error("agent listing returned empty array");
  const skillsRes = await fetch(new URL("/skill", listener.url), { headers });
  if (!skillsRes.ok) throw new Error("skill listing status " + skillsRes.status);
  const commandsRes = await fetch(new URL("/command", listener.url), { headers });
  if (!commandsRes.ok) throw new Error("command listing status " + commandsRes.status);
  if (!process.versions.electron) {
    await new Promise((resolve, reject) => {
      const url = new URL("/pty/" + ptyInfo.id + "/connect", listener.url);
      url.protocol = "ws:";
      url.searchParams.set("directory", process.env.OCO_SMOKE_PROJECT);
      url.username = "oco";
      url.password = process.env.OPENCODE_SERVER_PASSWORD;
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error("websocket timeout")), 5000);
      ws.addEventListener("message", (event) => {
        clearTimeout(timeout);
        if (!String(event.data).includes("pty-route-ok")) reject(new Error("websocket pty output mismatch"));
        ws.close();
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("websocket error")));
    });
  }
  await fetch(new URL("/pty/" + ptyInfo.id, listener.url), { method: "DELETE", headers });
} finally {
  await listener.stop(true);
}
`

const baseEnv = {
  ...process.env,
  XDG_DATA_HOME: path.join(tmp, "data"),
  XDG_CONFIG_HOME: path.join(tmp, "config"),
  XDG_CACHE_HOME: path.join(tmp, "cache"),
  XDG_STATE_HOME: path.join(tmp, "state"),
  OPENCODE_CLIENT: "desktop",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_SERVER_USERNAME: "oco",
  OPENCODE_SERVER_PASSWORD: "node-smoke",
  OCO_SMOKE_PROJECT: project,
}

async function run(runtime: string, env: Record<string, string | undefined>) {
  await $`${runtime} --input-type=module --eval ${code}`.env(env)
}

const runtime = process.env.OCO_NODE_SMOKE_RUNTIME ?? electronRuntime ?? "node"
const runtimeEnv = runtime === electronRuntime ? { ...baseEnv, ELECTRON_RUN_AS_NODE: "1" } : baseEnv

try {
  await run(runtime, runtimeEnv)
} catch (error) {
  const stderr = String((error as { stderr?: unknown }).stderr ?? error)
  if (
    runtime === electronRuntime ||
    process.env.OCO_NODE_SMOKE_RUNTIME ||
    !electronRuntime ||
    !stderr.includes("NODE_MODULE_VERSION")
  ) {
    throw error
  }
  await run(electronRuntime, { ...baseEnv, ELECTRON_RUN_AS_NODE: "1" })
}

console.log("Node backend smoke passed")
