import { createStore } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"

export type ModelKey = { providerID: string; modelID: string }
type SessionModelState = { model?: ModelKey; variant?: string }

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

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    let setModel: (model: ModelKey | undefined, options?: { recent?: boolean; variant?: string }) => void = () =>
      undefined

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const models = useModels()

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
          if (!value.model) return
          setModel(
            {
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            },
            { variant: value.variant },
          )
          if (value.variant)
            models.variant.set({ providerID: value.model.providerID, modelID: value.model.modelID }, value.variant)
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
          if (!value.model) return
          setModel(
            {
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            },
            { variant: value.variant },
          )
          if (value.variant)
            models.variant.set({ providerID: value.model.providerID, modelID: value.model.modelID }, value.variant)
        },
      }
    })()

    const model = (() => {
      const models = useModels()
      const currentSessionID = createMemo(() => params.id)

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey | undefined>
        session: Record<string, SessionModelState | undefined>
      }>({
        model: {},
        session: {},
      })

      const sameModel = (left: ModelKey | undefined, right: ModelKey | undefined) =>
        !!left && !!right && left.providerID === right.providerID && left.modelID === right.modelID

      const sessionState = (sessionID: string | undefined) => {
        if (!sessionID) return undefined
        return ephemeral.session[sessionID]
      }

      const setSessionState = (sessionID: string | undefined, value: SessionModelState | undefined) => {
        if (!sessionID) return
        setEphemeral("session", sessionID, value)
      }

      const resolveConfigured = () => {
        const configured = sync.data.config.model
        if (!configured) return
        const { providerID, id: modelID } = configured
        const key = { providerID, modelID }
        if (isModelValid(key)) return key
      }

      const resolveRecent = () => {
        for (const item of models.recent.list()) {
          if (isModelValid(item)) return item
        }
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
        return resolveConfigured() ?? resolveRecent() ?? resolveDefault()
      })

      const resolveVariantForModel = (key: ModelKey | undefined, currentAgent = agent.current()) => {
        if (!key) return undefined
        const model = models.find(key)
        if (!model) return undefined
        return resolveModelVariant({
          variants: Object.keys(model.variants ?? {}),
          selected: models.variant.get({ providerID: model.provider.id, modelID: model.id }),
          configured: getConfiguredAgentVariant({
            agent: currentAgent
              ? {
                  model: currentAgent.model,
                  variant: currentAgent.variant,
                }
              : undefined,
            model: {
              providerID: model.provider.id,
              modelID: model.id,
              variants: model.variants,
            },
          }),
        })
      }

      const current = createMemo(() => {
        const a = agent.current()
        const sessionID = currentSessionID()
        const key = getFirstValidModel(
          () => {
            const model = sessionState(sessionID)?.model
            if (!model) return undefined
            if (!isModelValid(model)) return undefined
            return model
          },
          () => (sessionID || !a ? undefined : ephemeral.model[a.name]),
          () => a?.model,
          fallbackModel,
        )
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
          const currentAgent = agent.current()
          const next = model ?? fallbackModel()
          if (currentAgent) setEphemeral("model", currentAgent.name, next)
          setSessionState(
            currentSessionID(),
            next
              ? {
                  model: next,
                  variant: options?.variant ?? resolveVariantForModel(next, currentAgent),
                }
              : undefined,
          )
          if (model) models.setVisibility(model, true)
          if (options?.recent && model) models.recent.push(model)
        })
      }

      setModel = set

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
          configured() {
            const a = agent.current()
            const m = current()
            if (!a || !m) return undefined
            return getConfiguredAgentVariant({
              agent: { model: a.model, variant: a.variant },
              model: { providerID: m.provider.id, modelID: m.id, variants: m.variants },
            })
          },
          selected() {
            const m = current()
            if (!m) return undefined
            const sessionID = currentSessionID()
            const key = { providerID: m.provider.id, modelID: m.id }
            const session = sessionState(sessionID)
            if (sameModel(session?.model, key)) return session?.variant
            if (sessionID) return undefined
            return models.variant.get(key)
          },
          current() {
            return resolveModelVariant({
              variants: this.list(),
              selected: this.selected(),
              configured: this.configured(),
            })
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
            const key = { providerID: m.provider.id, modelID: m.id }
            batch(() => {
              models.variant.set(key, value)
              setSessionState(currentSessionID(), { model: key, variant: value })
            })
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(
              cycleModelVariant({
                variants,
                selected: this.selected(),
                configured: this.configured(),
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
