import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { selectSubagentsForAutoHydration, SUBAGENT_DETAIL_BUDGET } from "./subagent-list-helpers"

function child(index: number): Session {
  return {
    id: `ses_${index}`,
    projectID: "proj",
    directory: "/tmp/project",
    title: `Child ${index}`,
    version: "0.0.0",
    time: { created: index, updated: index },
  } as Session
}

describe("selectSubagentsForAutoHydration", () => {
  test("hydrates only the bounded initial detail set by default", () => {
    const children = Array.from({ length: 90 }, (_, index) => child(index))

    expect(
      selectSubagentsForAutoHydration({
        children,
        statuses: {},
        hydrated: new Set(),
      }),
    ).toEqual(children.slice(0, SUBAGENT_DETAIL_BUDGET).map((session) => session.id))
  })

  test("also hydrates active children outside the initial budget", () => {
    const children = Array.from({ length: 90 }, (_, index) => child(index))

    const selected = selectSubagentsForAutoHydration({
      children,
      statuses: {
        ses_45: { type: "busy" },
        ses_70: { type: "retry", attempt: 1, message: "network", next: 0 },
      },
      hydrated: new Set(),
    })

    expect(selected).toEqual([...children.slice(0, SUBAGENT_DETAIL_BUDGET).map((session) => session.id), "ses_45", "ses_70"])
  })

  test("does not reschedule children that have already been hydrated or requested", () => {
    const children = Array.from({ length: 35 }, (_, index) => child(index))

    expect(
      selectSubagentsForAutoHydration({
        children,
        statuses: { ses_32: { type: "busy" } },
        hydrated: new Set(["ses_0", "ses_1", "ses_32"]),
      }),
    ).toEqual(children.slice(2, SUBAGENT_DETAIL_BUDGET).map((session) => session.id))
  })
})
