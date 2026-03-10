import { createEffect, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"

type Store = {
  version?: string
}

export const { use: useHighlights, provider: HighlightsProvider } = createSimpleContext({
  name: "Highlights",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [store, setStore, _, ready] = persisted("highlights.v1", createStore<Store>({ version: undefined }))
    const [from] = createSignal<string | undefined>(undefined)
    const [to] = createSignal<string | undefined>(undefined)

    const markSeen = () => {
      if (!platform.version) return
      setStore("version", platform.version)
    }

    createEffect(() => {
      if (!ready()) return
      if (!platform.version) return
      if (!store.version) {
        markSeen()
        return
      }
      if (store.version === platform.version) return
      markSeen()
    })

    return {
      ready,
      from,
      to,
      get last() {
        return store.version
      },
      markSeen,
    }
  },
})
