import type { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import type { Adapter } from "./adapter"

export const adapter: Adapter = {
  create(app: Hono) {
    const ws = createBunWebSocket()
    return {
      upgradeWebSocket: ws.upgradeWebSocket,
      listen(opts) {
        const args = {
          hostname: opts.hostname,
          idleTimeout: 0,
          fetch: app.fetch,
          websocket: ws.websocket,
        } as const
        const tryServe = (port: number) => {
          try {
            return Bun.serve({ ...args, port })
          } catch {
            return undefined
          }
        }
        const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
        if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
        if (!server.port) throw new Error(`Failed to resolve server address for port ${opts.port}`)
        return {
          port: server.port,
          stop(close?: boolean) {
            return server.stop(close)
          },
        }
      },
    }
  },
}
