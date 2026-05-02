import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"

export const SUBAGENT_DETAIL_BUDGET = 30

export function isActiveSubagentStatus(status: SessionStatus | undefined) {
  return status?.type === "busy" || status?.type === "retry"
}

export function selectSubagentsForAutoHydration(input: {
  children: Session[]
  statuses: Record<string, SessionStatus | undefined>
  hydrated: ReadonlySet<string>
  budget?: number
}) {
  const budget = input.budget ?? SUBAGENT_DETAIL_BUDGET
  const selected = new Set<string>()
  for (const session of input.children.slice(0, budget)) {
    if (!input.hydrated.has(session.id)) selected.add(session.id)
  }
  for (const session of input.children) {
    if (input.hydrated.has(session.id)) continue
    if (isActiveSubagentStatus(input.statuses[session.id])) selected.add(session.id)
  }
  return input.children.map((session) => session.id).filter((id) => selected.has(id))
}
