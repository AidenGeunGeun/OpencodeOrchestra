import { describe, expect, test } from "bun:test"
import { providerHasConfig, buildNextDisabledProviders } from "./provider-config-helpers"

describe("providerHasConfig", () => {
  test("returns true when provider exists in config with any shape", () => {
    expect(providerHasConfig("openai", { openai: { options: {} } })).toBe(true)
    expect(providerHasConfig("openai", { openai: { name: "OpenAI" } })).toBe(true)
    expect(providerHasConfig("openai", { openai: { npm: "@ai-sdk/openai", models: {} } })).toBe(true)
    expect(providerHasConfig("anthropic", { openai: {}, anthropic: {} })).toBe(true)
  })

  test("returns false when provider does not exist in config", () => {
    expect(providerHasConfig("openai", undefined)).toBe(false)
    expect(providerHasConfig("openai", {})).toBe(false)
    expect(providerHasConfig("openai", { anthropic: {} })).toBe(false)
  })
})

describe("buildNextDisabledProviders", () => {
  test("disables a provider not already disabled", () => {
    expect(buildNextDisabledProviders(undefined, "openai", "disable")).toEqual(["openai"])
    expect(buildNextDisabledProviders([], "openai", "disable")).toEqual(["openai"])
    expect(buildNextDisabledProviders(["anthropic"], "openai", "disable")).toEqual(["anthropic", "openai"])
  })

  test("does not duplicate an already disabled provider", () => {
    expect(buildNextDisabledProviders(["openai"], "openai", "disable")).toEqual(["openai"])
    expect(buildNextDisabledProviders(["openai", "anthropic"], "openai", "disable")).toEqual([
      "openai",
      "anthropic",
    ])
  })

  test("enables a disabled provider", () => {
    expect(buildNextDisabledProviders(["openai", "anthropic"], "openai", "enable")).toEqual(["anthropic"])
    expect(buildNextDisabledProviders(["openai"], "openai", "enable")).toEqual([])
  })

  test("enable is a no-op when provider is not disabled", () => {
    expect(buildNextDisabledProviders(["anthropic"], "openai", "enable")).toEqual(["anthropic"])
    expect(buildNextDisabledProviders(undefined, "openai", "enable")).toEqual([])
  })
})
