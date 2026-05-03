// @refresh reload

import {
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  type Platform,
  PlatformProvider,
  ServerConnection,
  createPerfCounter,
  isPerfEnabled,
  useCommand,
} from "@opencode-ai/app"
import type { AsyncStorage } from "@solid-primitives/storage"
import { MemoryRouter } from "@solidjs/router"
import { createEffect, createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { api as electronApi } from "./api"
import { initI18n, t } from "./i18n"
import type { ServerReadyData } from "../preload/types"
import { UPDATER_ENABLED } from "./updater"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { useTheme } from "@opencode-ai/ui/theme"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

const deepLinkEvent = "oco:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  const startUrls = window.__OPENCODE__?.deepLinks ?? []
  if (startUrls.length) emitDeepLinks(startUrls)
  return electronApi.onDeepLink((urls) => emitDeepLinks(urls))
}

const createPlatform = (): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const wslHome = async () => {
    if (os !== "windows" || !window.__OPENCODE__?.wsl) return undefined
    return electronApi.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !window.__OPENCODE__?.wsl) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => electronApi.wslPath(path, "linux").catch(() => path))) as any
    }
    return electronApi.wslPath(result, "linux").catch(() => result) as any
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()
    const counter = createPerfCounter("electron.storage.renderer")

    const track = async <T,>(name: string, operation: string, fn: () => Promise<T>) => {
      if (!isPerfEnabled()) return fn()
      const start = performance.now()
      try {
        return await fn()
      } finally {
        counter.record(`${operation}:${name}`, performance.now() - start)
      }
    }

    const createStorage = (name: string) => {
      const storageApi: AsyncStorage = {
        getItem: (key: string) => track(name, "get", () => electronApi.storeGet(name, key)),
        setItem: (key: string, value: string) => track(name, "set", () => electronApi.storeSet(name, key, value)),
        removeItem: (key: string) => track(name, "delete", () => electronApi.storeDelete(name, key)),
        clear: () => track(name, "clear", () => electronApi.storeClear(name)),
        key: async (index: number) => (await track(name, "keys", () => electronApi.storeKeys(name)))[index],
        getLength: () => track(name, "length", () => electronApi.storeLength(name)),
        get length() {
          return storageApi.getLength()
        },
      }
      return storageApi
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await electronApi.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await electronApi.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: [],
        extensions: [],
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await electronApi.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      electronApi.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await electronApi.resolveAppPath(app).catch(() => null) : null
        const resolvedPath = await (async () => {
          if (window.__OPENCODE__?.wsl) {
            const converted = await electronApi.wslPath(path, "windows").catch(() => null)
            if (converted) return converted
          }
          return path
        })()
        return electronApi.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return electronApi.openPath(path, app)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      if (!UPDATER_ENABLED()) return { updateAvailable: false }
      return electronApi.checkUpdate()
    },

    update: async () => {
      if (!UPDATER_ENABLED()) return
      await electronApi.installUpdate()
    },

    restart: async () => {
      await electronApi.killSidecar().catch(() => undefined)
      electronApi.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await electronApi.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://github.com/AidenGeunGeun/OpenCodeOrchestra/raw/main/packages/app/public/favicon-96x96.png",
      })
      notification.onclick = () => {
        void electronApi.showWindow()
        void electronApi.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: async () => {
      const next = await electronApi.getWslConfig().catch(() => null)
      if (next) return next.enabled
      return window.__OPENCODE__!.wsl ?? false
    },

    setWslEnabled: async (enabled) => {
      await electronApi.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await electronApi.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: ServerConnection.Key | null) => {
      await electronApi.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      return electronApi.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await electronApi.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => electronApi.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return electronApi.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await electronApi.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
electronApi.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

let sidecarCache: ServerReadyData | undefined
let sidecarPromise: Promise<ServerReadyData> | undefined
function getSidecarReady() {
  if (sidecarCache) return sidecarCache
  sidecarPromise ??= electronApi
    .awaitInitialization(() => undefined)
    .then((data) => {
      sidecarCache = data
      return data
    })
  return sidecarPromise
}

let windowCountCache: number | undefined
let windowCountPromise: Promise<number> | undefined
function getWindowCount() {
  if (windowCountCache !== undefined) return windowCountCache
  windowCountPromise ??= electronApi.getWindowCount().then((value) => {
    windowCountCache = value
    return value
  })
  return windowCountPromise
}

let defaultServerCache: ServerConnection.Key | null | undefined
let defaultServerPromise: Promise<ServerConnection.Key | null> | undefined
function getDefaultServer(platform: Platform) {
  if (defaultServerCache !== undefined) return defaultServerCache
  defaultServerPromise ??= (platform.getDefaultServer?.() ?? Promise.resolve(null)).then((value) => {
    defaultServerCache = value
    return value
  })
  return defaultServerPromise
}

render(() => {
  const platform = createPlatform()
  const [windowCount] = createResource(getWindowCount)

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(getSidecarReady)

  const [defaultServer] = createResource(() => getDefaultServer(platform))
  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void electronApi.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show when={!defaultServer.loading && !sidecar.loading && !windowCount.loading}>
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
                router={MemoryRouter}
                disableHealthCheck
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
