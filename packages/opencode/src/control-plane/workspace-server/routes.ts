import { GlobalBus } from "../../bus/global"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { Instance } from "../../project/instance"

export function WorkspaceServerRoutes() {
  return new Hono().get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, async (stream) => {
      const send = async (event: unknown) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
      const handler = async (event: { directory?: string; payload: unknown }) => {
        if (event.directory && event.directory !== Instance.directory) return
        await send(event.payload)
      }
      GlobalBus.on("event", handler)
      await send({ type: "server.connected", properties: {} })
      const heartbeat = setInterval(() => {
        void send({ type: "server.heartbeat", properties: {} })
      }, 10_000)

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          GlobalBus.off("event", handler)
          resolve()
        })
      })
    })
  })
}
