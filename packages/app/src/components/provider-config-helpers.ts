export function providerHasConfig(providerID: string, configProvider: Record<string, unknown> | undefined): boolean {
  return !!configProvider?.[providerID]
}

export function buildNextDisabledProviders(
  current: string[] | undefined,
  providerID: string,
  action: "disable" | "enable",
): string[] {
  const before = current ?? []
  if (action === "disable") {
    return before.includes(providerID) ? before : [...before, providerID]
  }
  return before.filter((id) => id !== providerID)
}
