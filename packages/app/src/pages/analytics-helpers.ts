import type { AnalyticsSummary } from "@opencode-ai/sdk/v2/client"

export function analyticsDisplayedSummary(current: AnalyticsSummary | undefined, latest: AnalyticsSummary | undefined) {
  return current ?? latest
}
