import { describe, expect, test } from "bun:test"
import { analyticsDisplayedSummary } from "./analytics-helpers"

describe("analytics period-switch refresh behavior", () => {
  test("keeps the latest populated dashboard visible while a new resource fetch is in flight", () => {
    const latest = { generatedAt: 1 } as any

    expect(analyticsDisplayedSummary(undefined, latest)).toBe(latest)
  })

  test("uses fresh data once the refetch completes", () => {
    const latest = { generatedAt: 1 } as any
    const current = { generatedAt: 2 } as any

    expect(analyticsDisplayedSummary(current, latest)).toBe(current)
  })
})
