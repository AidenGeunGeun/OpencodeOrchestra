import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Config } from "../../config/config"
import { Analytics } from "@/session/analytics"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the OpenCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/analytics",
      describeRoute({
        summary: "Get analytics summary",
        description:
          "Get compact local usage analytics without exposing conversation content or tool output. " +
          "When `project` is omitted, the summary covers every project with usage in the selected period.",
        operationId: "global.analytics",
        responses: {
          200: {
            description: "Analytics summary",
            content: {
              "application/json": {
                schema: resolver(Analytics.Summary),
              },
            },
          },
        },
      }),
      validator("query", Analytics.Query),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await Analytics.summary(query))
      },
    )
    .post(
      "/analytics/rebuild",
      describeRoute({
        summary: "Rebuild analytics summary cache",
        description:
          "Clear the persistent analytics summary store and trigger a fresh backfill. " +
          "Returns the current backfill progress state.",
        operationId: "global.analyticsRebuild",
        responses: {
          200: {
            description: "Analytics rebuild started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    total: z.number(),
                    processed: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Analytics.rebuildSummary({ period: "30d" })
        return c.json(result.backfilling ?? { total: 0, processed: 0 })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s — Desktop client times out after 15s
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 10000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/reload",
      describeRoute({
        summary: "Reload configuration",
        description: "Reload all configuration, skills, and prompts from disk without restarting the server.",
        operationId: "global.reload",
        responses: {
          200: {
            description: "Reload complete",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        Config.global.reset()
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    ),
)
