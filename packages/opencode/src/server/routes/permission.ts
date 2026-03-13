import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const PermissionRoutes = lazy(() =>
  new Hono()
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      validator("json", z.object({ reply: PermissionNext.Reply, message: z.string().optional() })),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const request = (await PermissionNext.list()).find((item) => item.id === params.requestID)
        if (!request) return c.json(true)
        await Session.get(request.sessionID)
        await PermissionNext.reply({
          requestID: params.requestID,
          reply: json.reply,
          message: json.message,
        })
        return c.json(true)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const permissions = await PermissionNext.list()
        const visible = await Promise.all(
          permissions.map(async (item) => {
            try {
              await Session.get(item.sessionID)
              return item
            } catch {
              return undefined
            }
          }),
        )
        return c.json(visible.filter((item): item is (typeof permissions)[number] => !!item))
      },
    ),
)
