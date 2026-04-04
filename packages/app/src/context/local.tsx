import { createStore } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { cycleModelVariant, getConfiguredAgentVariant } from "./model-variant"
import { resolveSessionModelSelection } from "@/pages/session/session-model-helpers"

export type ModelKey = { providerID: string; modelID: string }
type SessionModelState = { model?: ModelKey; variant?: string; source?: "manual" | "submit" }
type DraftSessionState = { dir: string; key: string }

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()
    const params = useParams()
    const connected = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))

      const [store, setStore] = createStore<{
        current?: string
      }>({
        current: list()[0]?.name,
      })
      return {
        list,
        current() {
          const available = list()
          if (available.length === 0) return undefined
          return available.find((x) => x.name === store.current) ?? available[0]
        },
        set(name: string | undefined) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          const match = name ? available.find((x) => x.name === name) : undefined
          const value = match ?? available[0]
          if (!value) return
          setStore("current", value.name)
        },
        move(direction: 1 | -1) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          let next = available.findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = available.length - 1
          if (next >= available.length) next = 0
          const value = available[next]
          if (!value) return
          setStore("current", value.name)
        },
      }
    })()

    const model = (() => {
      const models = useModels()
      const currentSessionID = createMemo(() => params.id)
      const draftSession = createMemo<DraftSessionState | undefined>((prev) => {
        const dir = params.dir ?? base64Encode(sdk.directory)
        if (params.id) return undefined
        if (prev?.dir === dir) return prev
        return {
          dir,
          key: `draft:${dir}:${crypto.randomUUID()}`,
        }
      })
      const currentSessionKey = createMemo(() => {
        const sessionID = params.id
        const draft = draftSession()
        if (!draft) return sessionID
        if (!sessionID) return draft.key
        return sessionID
      })

      const [ephemeral, setEphemeral] = createStore<{
        session: Record<string, SessionModelState | undefined>
      }>({
        session: {},
      })

      const sessionState = (sessionID: string | undefined) => {
        if (!sessionID) return undefined
        return ephemeral.session[sessionID]
      }

      const setSessionState = (sessionID: string | undefined, value: SessionModelState | undefined) => {
        if (!sessionID) return
        setEphemeral("session", sessionID, value)
      }

      const resolveDefault = () => {
        const defaults = providers.default()
        for (const provider of providers.connected()) {
          const configured = defaults[provider.id]
          if (configured) {
            const key = { providerID: provider.id, modelID: configured }
            if (isModelValid(key)) return key
          }

          const first = Object.values(provider.models)[0]
          if (!first) continue
          const key = { providerID: provider.id, modelID: first.id }
          if (isModelValid(key)) return key
        }
      }

      const fallbackModel = createMemo<ModelKey | undefined>(() => {
        return resolveDefault()
      })

      const resolveConfiguredVariant = (key: ModelKey | undefined, currentAgent = agent.current()) => {
        if (!key) return undefined
        const configuredModel = models.find(key)
        if (!configuredModel) return undefined
        return getConfiguredAgentVariant({
          agent: currentAgent
            ? {
                model: currentAgent.model,
                variant: currentAgent.variant,
              }
            : undefined,
          model: {
            providerID: configuredModel.provider.id,
            modelID: configuredModel.id,
            variants: configuredModel.variants,
          },
        })
      }

      const resolved = createMemo(() => {
        const currentAgent = agent.current()
        const sessionID = currentSessionID()
        const session = sessionState(currentSessionKey())
        const messages = sessionID ? sync.data.message[sessionID] : undefined
        const revertMessageID = sessionID ? sync.session.get(sessionID)?.revert?.messageID : undefined
        if (sessionID && messages === undefined && !session) {
          return { model: undefined, variant: undefined }
        }
        return resolveSessionModelSelection({
          session,
          messages,
          revertMessageID,
          agent: currentAgent
            ? {
                model: currentAgent.model,
                variant: currentAgent.variant,
              }
            : undefined,
          fallback: fallbackModel(),
          isModelValid,
        })
      })

      const current = createMemo(() => {
        const key = resolved().model
        if (!key) return undefined
        return models.find(key)
      })

      const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

      const cycle = (direction: 1 | -1) => {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      const set = (model: ModelKey | undefined, options?: { recent?: boolean; variant?: string }) => {
        batch(() => {
          setSessionState(
            currentSessionKey(),
            model
              ? {
                  model,
                  variant: options?.variant ?? resolveConfiguredVariant(model),
                  source: "manual",
                }
              : undefined,
          )
          if (model) models.setVisibility(model, true)
          if (options?.recent && model) models.recent.push(model)
        })
      }

      return {
        ready: models.ready,
        current,
        recent,
        list: models.list,
        cycle,
        set,
        visible(model: ModelKey) {
          return models.visible(model)
        },
        setVisibility(model: ModelKey, visible: boolean) {
          models.setVisibility(model, visible)
        },
        session: {
          current(sessionID: string | undefined) {
            return sessionState(sessionID)
          },
          set(sessionID: string, value: SessionModelState | undefined) {
            setSessionState(sessionID, value)
          },
        },
        variant: {
          selected() {
            return resolved().variant
          },
          current() {
            const selected = this.selected()
            if (!selected) return undefined
            if (!this.list().includes(selected)) return undefined
            return selected
          },
          list() {
            const m = current()
            if (!m) return []
            if (!m.variants) return []
            return Object.keys(m.variants)
          },
          set(value: string | undefined) {
            const m = current()
            if (!m) return
            setSessionState(currentSessionKey(), {
              model: { providerID: m.provider.id, modelID: m.id },
              variant: value,
              source: "manual",
            })
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(
              cycleModelVariant({
                variants,
                selected: this.selected(),
                configured: undefined,
              }),
            )
          },
        },
      }
    })()

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
    }
    return result
  },
})
