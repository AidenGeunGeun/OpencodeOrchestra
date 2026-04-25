import { createAdaptorServer, type ServerType } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import type { Hono } from "hono"
import type { Adapter } from "./adapter"

export const adapter: Adapter = {
  create(app: Hono) {
    const ws = createNodeWebSocket({ app })
    return {
      upgradeWebSocket: ws.upgradeWebSocket,
      async listen(opts) {
        const start = (port: number) =>
          new Promise<ServerType>((resolve, reject) => {
            const server = createAdaptorServer({ fetch: app.fetch })
            ws.injectWebSocket(server)
            const fail = (error: Error) => {
              cleanup()
              reject(error)
            }
            const ready = () => {
              cleanup()
              resolve(server)
            }
            const cleanup = () => {
              server.off("error", fail)
              server.off("listening", ready)
            }
            server.once("error", fail)
            server.once("listening", ready)
            server.listen(port, opts.hostname)
          })

        const server = await start(opts.port)
        const addr = server.address()
        if (!addr || typeof addr === "string") throw new Error(`Failed to resolve server address for port ${opts.port}`)

        let closing: Promise<void> | undefined
        return {
          port: addr.port,
          stop(close?: boolean) {
            closing ??= new Promise((resolve, reject) => {
              server.close((error) => {
                if (error) {
                  reject(error)
                  return
                }
                resolve()
              })
              if (close) {
                if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
                  server.closeAllConnections()
                }
                if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
                  server.closeIdleConnections()
                }
              }
            })
            return closing
          },
        }
      },
    }
  },
}
