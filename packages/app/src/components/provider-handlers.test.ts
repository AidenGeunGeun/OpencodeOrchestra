import { describe, expect, test } from "bun:test"
import {
  handleDisconnect,
  enableProviderIfDisabled,
  handleConnectComplete,
} from "./provider-handlers"

function createCallLog<T extends (...args: any[]) => any>(fn: T): { calls: any[][], fn: T } {
  const calls: any[][] = []
  const wrapped = ((...args: any[]) => {
    calls.push(args)
    return fn(...args)
  }) as T
  return { calls, fn: wrapped }
}

describe("handleDisconnect", () => {
  test("config-present path: calls auth.remove, disableProvider, global.dispose in order", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async (id: string) => { order.push(`authRemove:${id}`) },
      disableProvider: async (id: string, name: string) => { order.push(`disableProvider:${id}:${name}`) },
      globalDispose: async () => { order.push("globalDispose") },
      showSuccessToast: () => { order.push("showSuccessToast") },
      showErrorToast: () => { order.push("showErrorToast") },
    }

    await handleDisconnect("openai", "OpenAI", true, deps)

    expect(order).toEqual(["authRemove:openai", "disableProvider:openai:OpenAI", "globalDispose"])
  })

  test("config-present path: swallows auth.remove errors and continues", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async () => { order.push("authRemove"); throw new Error("network") },
      disableProvider: async () => { order.push("disableProvider") },
      globalDispose: async () => { order.push("globalDispose") },
      showSuccessToast: () => {},
      showErrorToast: () => {},
    }

    await handleDisconnect("openai", "OpenAI", true, deps)

    expect(order).toEqual(["authRemove", "disableProvider", "globalDispose"])
  })

  test("config-present path: swallows global.dispose errors and completes", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async () => { order.push("authRemove") },
      disableProvider: async () => { order.push("disableProvider") },
      globalDispose: async () => { order.push("globalDispose"); throw new Error("dispose fail") },
      showSuccessToast: () => {},
      showErrorToast: () => {},
    }

    await handleDisconnect("openai", "OpenAI", true, deps)

    expect(order).toEqual(["authRemove", "disableProvider", "globalDispose"])
  })

  test("non-config path: calls auth.remove then global.dispose then success toast on success", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async (id: string) => { order.push(`authRemove:${id}`) },
      disableProvider: async () => { order.push("disableProvider") },
      globalDispose: async () => { order.push("globalDispose") },
      showSuccessToast: (name: string) => { order.push(`showSuccessToast:${name}`) },
      showErrorToast: () => { order.push("showErrorToast") },
    }

    await handleDisconnect("anthropic", "Anthropic", false, deps)

    expect(order).toEqual(["authRemove:anthropic", "globalDispose", "showSuccessToast:Anthropic"])
  })

  test("non-config path: calls error toast on auth.remove failure", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async () => { order.push("authRemove"); throw new Error("auth fail") },
      disableProvider: async () => { order.push("disableProvider") },
      globalDispose: async () => { order.push("globalDispose") },
      showSuccessToast: () => { order.push("showSuccessToast") },
      showErrorToast: (msg: string) => { order.push(`showErrorToast:${msg}`) },
    }

    await handleDisconnect("anthropic", "Anthropic", false, deps)

    expect(order).toEqual(["authRemove", "showErrorToast:auth fail"])
  })

  test("non-config path: calls error toast on global.dispose failure", async () => {
    const order: string[] = []

    const deps = {
      authRemove: async () => { order.push("authRemove") },
      disableProvider: async () => { order.push("disableProvider") },
      globalDispose: async () => { order.push("globalDispose"); throw new Error("dispose fail") },
      showSuccessToast: () => { order.push("showSuccessToast") },
      showErrorToast: (msg: string) => { order.push(`showErrorToast:${msg}`) },
    }

    await handleDisconnect("anthropic", "Anthropic", false, deps)

    expect(order).toEqual(["authRemove", "globalDispose", "showErrorToast:dispose fail"])
  })
})

describe("enableProviderIfDisabled", () => {
  test("strips provider from disabled_providers when present", async () => {
    let setValue: string[] | undefined
    const configPatches: { disabled_providers: string[] }[] = []

    const deps = {
      getDisabledProviders: () => ["openai", "anthropic"],
      setDisabledProviders: (next: string[]) => { setValue = next },
      updateConfig: async (patch: { disabled_providers: string[] }) => { configPatches.push(patch) },
      showErrorToast: () => {},
    }

    await enableProviderIfDisabled("openai", deps)

    expect(setValue).toEqual(["anthropic"])
    expect(configPatches).toEqual([{ disabled_providers: ["anthropic"] }])
  })

  test("is a no-op when provider is not disabled", async () => {
    let setValue: string[] | undefined
    const configPatches: { disabled_providers: string[] }[] = []

    const deps = {
      getDisabledProviders: () => ["anthropic"],
      setDisabledProviders: (next: string[]) => { setValue = next },
      updateConfig: async (patch: { disabled_providers: string[] }) => { configPatches.push(patch) },
      showErrorToast: () => {},
    }

    await enableProviderIfDisabled("openai", deps)

    expect(setValue).toBeUndefined()
    expect(configPatches).toEqual([])
  })

  test("reverts optimistic update on updateConfig failure", async () => {
    const values: string[][] = []

    const deps = {
      getDisabledProviders: () => ["openai", "anthropic"],
      setDisabledProviders: (next: string[]) => { values.push(next) },
      updateConfig: async () => { throw new Error("save failed") },
      showErrorToast: (msg: string) => { values.push([`error:${msg}`]) },
    }

    await enableProviderIfDisabled("openai", deps)

    expect(values).toEqual([["anthropic"], ["openai", "anthropic"], ["error:save failed"]])
  })
})

describe("handleConnectComplete", () => {
  test("calls enableProviderIfDisabled, global.dispose, closeDialog, successToast in order", async () => {
    const order: string[] = []

    const deps = {
      enableProviderIfDisabled: async (id: string) => { order.push(`enable:${id}`) },
      globalDispose: async () => { order.push("dispose") },
      closeDialog: () => { order.push("closeDialog") },
      showSuccessToast: (name: string) => { order.push(`toast:${name}`) },
    }

    await handleConnectComplete("openai", "OpenAI", deps)

    expect(order).toEqual(["enable:openai", "dispose", "closeDialog", "toast:OpenAI"])
  })

  test("propagates error from enableProviderIfDisabled and still completes", async () => {
    const order: string[] = []

    const deps = {
      enableProviderIfDisabled: async (id: string) => { order.push(`enable:${id}`); throw new Error("enable fail") },
      globalDispose: async () => { order.push("dispose") },
      closeDialog: () => { order.push("closeDialog") },
      showSuccessToast: (name: string) => { order.push(`toast:${name}`) },
    }

    await expect(handleConnectComplete("openai", "OpenAI", deps)).rejects.toThrow("enable fail")
    expect(order).toEqual(["enable:openai"])
  })
})
