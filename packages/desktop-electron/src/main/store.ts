import Store from "electron-store"

import { SETTINGS_STORE } from "./constants"

const cache = new Map<string, Store>()

// OCO: keep desktop storage compatible with Tauri's flat dotted keys.
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({ name, fileExtension: "", accessPropertiesByDotNotation: false })
  cache.set(name, next)
  return next
}
