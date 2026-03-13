import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Question } from "../../question"
import { Session } from "@/session"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: {
              "application/json": {
                schema: resolver(Question.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const questions = await Question.list()
        const visible = await Promise.all(
          questions.map(async (item) => {
            try {
              await Session.get(item.sessionID)
              return item
            } catch {
              return undefined
            }
          }),
        )
        return c.json(visible.filter((item): item is (typeof questions)[number] => !!item))
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
        operationId: "question.reply",
        responses: {
          200: {
            description: "Question answered successfully",
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
      validator("json", Question.Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const request = (await Question.list()).find((item) => item.id === params.requestID)
        if (!request) return c.json(true)
        await Session.get(request.sessionID)
        await Question.reply({
          requestID: params.requestID,
          answers: json.answers,
        })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
        operationId: "question.reject",
        responses: {
          200: {
            description: "Question rejected successfully",
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
      async (c) => {
        const params = c.req.valid("param")
        const request = (await Question.list()).find((item) => item.id === params.requestID)
        if (!request) return c.json(true)
        await Session.get(request.sessionID)
        await Question.reject(params.requestID)
        return c.json(true)
      },
    ),
)
