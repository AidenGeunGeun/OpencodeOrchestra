import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
}

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    const frontendDir = Server.resolveFrontendDir()
    if (frontendDir) {
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local frontend:    ", UI.Style.TEXT_NORMAL, `serving from ${frontendDir}`)
    } else {
      UI.println(
        UI.Style.TEXT_INFO_BOLD + "  Frontend:          ",
        UI.Style.TEXT_NORMAL,
        "proxied from app.opencode.ai (build packages/app for local serving)",
      )
    }
    // Warn loudly when we are ignoring a legacy XDG frontend bundle. Older installs used
    // to drop assets in ~/.local/share/oco/frontend; the auto-resolver no longer falls
    // back to that path so a stale UI cannot silently override the proxy or a packaged
    // binary. Users who deliberately want it back can set OPENCODE_FRONTEND_DIR.
    const legacy = Server.legacyXdgFrontendDir()
    if (legacy && !process.env.OPENCODE_FRONTEND_DIR) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!  Stale XDG frontend found at ",
        UI.Style.TEXT_NORMAL,
        `${legacy}.`,
      )
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "   Ignoring it to avoid serving outdated UI. Set ",
        UI.Style.TEXT_NORMAL,
        "OPENCODE_FRONTEND_DIR=<path> to opt back in, or remove the directory.",
      )
    }

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `opencode.local:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    await new Promise(() => {})
    await server.stop()
  },
})
