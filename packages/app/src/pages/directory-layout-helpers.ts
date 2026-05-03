export function routeResolvedDirectory(input: { resolved: string; resolvedRoute: string }, route: string | undefined) {
  if (!route) return ""
  if (input.resolvedRoute !== route) return ""
  return input.resolved
}
