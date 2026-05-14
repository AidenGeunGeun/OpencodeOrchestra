import { buildNextDisabledProviders } from "./provider-config-helpers"

export interface DisconnectHandlerDeps {
  authRemove: (providerID: string) => Promise<unknown>
  disableProvider: (providerID: string, name: string) => Promise<unknown>
  globalDispose: () => Promise<unknown>
  showSuccessToast: (name: string) => void
  showErrorToast: (message: string) => void
}

export async function handleDisconnect(
  providerID: string,
  name: string,
  hasConfig: boolean,
  deps: DisconnectHandlerDeps,
) {
  if (hasConfig) {
    await deps.authRemove(providerID).catch(() => undefined)
    await deps.disableProvider(providerID, name)
    await deps.globalDispose().catch(() => undefined)
    return
  }

  try {
    await deps.authRemove(providerID)
    await deps.globalDispose()
    deps.showSuccessToast(name)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    deps.showErrorToast(message)
  }
}

export interface EnableProviderDeps {
  getDisabledProviders: () => string[] | undefined
  setDisabledProviders: (next: string[]) => void
  updateConfig: (patch: { disabled_providers: string[] }) => Promise<unknown>
  showErrorToast: (message: string) => void
}

export async function enableProviderIfDisabled(providerID: string, deps: EnableProviderDeps) {
  const disabledProviders = deps.getDisabledProviders() ?? []
  const next = buildNextDisabledProviders(disabledProviders, providerID, "enable")
  if (next.length === disabledProviders.length) return
  deps.setDisabledProviders(next)
  try {
    await deps.updateConfig({ disabled_providers: next })
  } catch (err: unknown) {
    deps.setDisabledProviders(disabledProviders)
    const message = err instanceof Error ? err.message : String(err)
    deps.showErrorToast(message)
  }
}

export interface ConnectCompleteDeps {
  enableProviderIfDisabled: (providerID: string) => Promise<unknown>
  globalDispose: () => Promise<unknown>
  closeDialog: () => void
  showSuccessToast: (name: string) => void
}

export async function handleConnectComplete(
  providerID: string,
  providerName: string,
  deps: ConnectCompleteDeps,
) {
  await deps.enableProviderIfDisabled(providerID)
  await deps.globalDispose()
  deps.closeDialog()
  deps.showSuccessToast(providerName)
}
