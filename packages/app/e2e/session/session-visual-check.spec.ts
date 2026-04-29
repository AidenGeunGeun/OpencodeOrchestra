// OCO-only file: agent-facing visual verification for Tool Dock UI work. See oco-dev skill deltas-catalog.md.

import fs from "node:fs/promises"
import path from "node:path"
import type { Page } from "@playwright/test"
import { cleanupSession, withSession } from "../actions"
import { test, expect } from "../fixtures"

type ToolDockTab = "review" | "subagents" | "browser"

type ToolDockPanelState = {
  value: ToolDockTab
  exists: boolean
  visible: boolean
  hidden: boolean
  ariaHidden: string | null
  rect: { x: number; y: number; width: number; height: number } | null
  text: string
}

type ToolDockState = {
  active: ToolDockTab
  viewport: { width: number; height: number }
  document: { clientWidth: number; scrollWidth: number; bodyScrollWidth: number }
  dock: {
    exists: boolean
    visible: boolean
    ariaHidden: string | null
    rect: { x: number; y: number; width: number; height: number } | null
  }
  tabs: Array<{
    value: ToolDockTab
    exists: boolean
    selected: boolean
    text: string
    rect: { x: number; y: number; width: number; height: number } | null
  }>
  panels: ToolDockPanelState[]
}

const toolTabs: Array<{ value: ToolDockTab; label: RegExp; screenshot: string }> = [
  { value: "review", label: /Review/i, screenshot: "tool-dock-review.png" },
  { value: "subagents", label: /Subagents/i, screenshot: "tool-dock-subagents.png" },
  { value: "browser", label: /Browser/i, screenshot: "tool-dock-browser.png" },
]

const runId = (process.env.OCO_VISUAL_CHECK_RUN_ID ?? String(Date.now())).replace(/[^a-zA-Z0-9._-]/g, "-")
const artifactDir = path.join("/tmp", `oco-visual-check-${runId || Date.now()}`)

function problems(state: ToolDockState) {
  const missingTabs = state.tabs.filter((tab) => !tab.exists).map((tab) => tab.value)
  const missingPanels = state.panels.filter((panel) => !panel.exists).map((panel) => panel.value)
  const activePanel = state.panels.find((panel) => panel.value === state.active)
  const inactiveVisible = state.panels.filter((panel) => panel.value !== state.active && panel.visible).map((panel) => panel.value)
  const selectedTabs = state.tabs.filter((tab) => tab.selected).map((tab) => tab.value)
  const dock = state.dock.rect
  const tolerance = 1

  return {
    dockHidden: !state.dock.exists || !state.dock.visible || state.dock.ariaHidden === "true",
    dockOutOfBounds:
      !dock ||
      dock.x < -tolerance ||
      dock.y < -tolerance ||
      dock.x + dock.width > state.viewport.width + tolerance ||
      dock.y + dock.height > state.viewport.height + tolerance,
    horizontalOverflow:
      state.document.scrollWidth > state.document.clientWidth + tolerance ||
      state.document.bodyScrollWidth > state.viewport.width + tolerance,
    missingTabs,
    missingPanels,
    activePanelHidden: !activePanel?.visible,
    inactiveVisible,
    selectedTabs,
    wrongSelection: selectedTabs.length !== 1 || selectedTabs[0] !== state.active,
  }
}

async function enableDesktopWebFallback(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & { __opencode_e2e?: { platform?: "web" | "desktop" } }
    win.__opencode_e2e = { ...(win.__opencode_e2e ?? {}), platform: "desktop" }

    const proto = HTMLElement.prototype as HTMLElement & {
      loadURL?: (url: string) => Promise<void>
      reload?: () => void
      goBack?: () => void
      goForward?: () => void
      canGoBack?: () => boolean
      canGoForward?: () => boolean
      getURL?: () => string
      getTitle?: () => string
      executeJavaScript?: <T = unknown>(code: string) => Promise<T>
      capturePage?: () => Promise<{ toDataURL(): string }>
    }

    proto.loadURL ??= async function (this: HTMLElement, url: string) {
      this.setAttribute("src", url)
      this.dispatchEvent(new Event("did-start-loading"))
      this.dispatchEvent(new Event("did-stop-loading"))
    }
    proto.reload ??= function () {}
    proto.goBack ??= function () {}
    proto.goForward ??= function () {}
    proto.canGoBack ??= () => false
    proto.canGoForward ??= () => false
    proto.getURL ??= function (this: HTMLElement) {
      return this.getAttribute("src") ?? "about:blank"
    }
    proto.getTitle ??= () => "Visual check browser stub"
    proto.executeJavaScript ??= async (code) => {
      if (code.includes("__ocoBrowserCommentsInstalled")) return false as never
      return undefined as never
    }
    proto.capturePage ??= async () => ({
      toDataURL: () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH+Av+1AAAAAElFTkSuQmCC",
    })
  })
}

async function seedOversizedLayout(page: Page, sessionWidth: number) {
  await page.addInitScript((sessionWidth) => {
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({
        review: { panelOpened: true },
        fileTree: { opened: false, width: 344, tab: "changes" },
        session: { width: sessionWidth },
      }),
    )
  }, sessionWidth)
}

async function openToolDock(page: Page) {
  const treeToggle = page.getByRole("button", { name: "Toggle file tree" }).first()
  if ((await treeToggle.getAttribute("aria-expanded").catch(() => null)) === "true") await treeToggle.click()

  const reviewToggle = page.getByRole("button", { name: "Toggle Tool Dock" }).first()
  await expect(reviewToggle).toBeVisible()
  if ((await reviewToggle.getAttribute("aria-expanded")) !== "true") await reviewToggle.click()

  await expect(reviewToggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
}

async function restoreHiddenTool(page: Page, label: RegExp) {
  const trigger = page.getByRole("tab", { name: label }).first()
  if (await trigger.isVisible().catch(() => false)) return

  await page.getByRole("button", { name: /Restore hidden Tool Dock tab/i }).click()
  await page.getByRole("menuitem", { name: label }).click()
  await expect(trigger).toBeVisible()
}

async function collectToolDockState(page: Page, active: ToolDockTab) {
  return page.evaluate((active): ToolDockState => {
    const values: ToolDockTab[] = ["review", "subagents", "browser"]
    const dock = document.querySelector("#review-panel")

    const rect = (el: Element | null) => {
      if (!el) return null
      const box = el.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }

    const visible = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return false
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return !el.hidden && el.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0
    }

    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400)
    const trigger = (value: ToolDockTab) => dock?.querySelector(`[data-slot="tabs-trigger"][data-value="${value}"]`) ?? null
    const panel = (value: ToolDockTab) => dock?.querySelector(`[data-tool-dock-content="${value}"]`) ?? null

    return {
      active,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
      dock: {
        exists: !!dock,
        visible: visible(dock),
        ariaHidden: dock?.getAttribute("aria-hidden") ?? null,
        rect: rect(dock),
      },
      tabs: values.map((value) => {
        const el = trigger(value)
        return {
          value,
          exists: !!el,
          selected: el?.getAttribute("aria-selected") === "true",
          text: text(el),
          rect: rect(el),
        }
      }),
      panels: values.map((value) => {
        const el = panel(value)
        return {
          value,
          exists: !!el,
          visible: visible(el),
          hidden: el instanceof HTMLElement ? el.hidden : false,
          ariaHidden: el?.getAttribute("aria-hidden") ?? null,
          rect: rect(el),
          text: text(el),
        }
      }),
    }
  }, active)
}

async function captureState(page: Page, tab: (typeof toolTabs)[number]) {
  const state = await collectToolDockState(page, tab.value)
  const issue = problems(state)
  await fs.writeFile(path.join(artifactDir, `${tab.value}.state.json`), JSON.stringify({ state, problems: issue }, null, 2))
  await page.screenshot({ path: path.join(artifactDir, tab.screenshot), fullPage: false })
  return { tab: tab.value, screenshot: path.join(artifactDir, tab.screenshot), state, problems: issue }
}

async function captureShrinkState(page: Page) {
  const state = await collectToolDockState(page, "subagents")
  const issue = problems(state)
  const screenshot = path.join(artifactDir, "tool-dock-shrink.png")
  await fs.writeFile(path.join(artifactDir, "shrink.state.json"), JSON.stringify({ state, problems: issue }, null, 2))
  await page.screenshot({ path: screenshot, fullPage: false })
  return { screenshot, state, problems: issue }
}

test("Tool Dock detector flags inactive panel overlap", async ({ page }) => {
  await page.setContent(`
    <aside id="review-panel" aria-hidden="false" style="width: 600px; height: 400px; display: block; visibility: visible;">
      <button role="tab" data-slot="tabs-trigger" data-value="review" aria-selected="true">Review</button>
      <button role="tab" data-slot="tabs-trigger" data-value="subagents" aria-selected="false">Subagents</button>
      <button role="tab" data-slot="tabs-trigger" data-value="browser" aria-selected="false">Browser</button>
      <section data-tool-dock-content="review" style="display: block; width: 300px; height: 120px;">Review content</section>
      <section data-tool-dock-content="subagents" style="display: block; width: 300px; height: 120px;">Subagents content should be hidden</section>
      <section data-tool-dock-content="browser" style="display: block; width: 300px; height: 120px;">Browser content should be hidden</section>
    </aside>
  `)

  const issue = problems(await collectToolDockState(page, "review"))
  expect(issue.inactiveVisible.sort()).toEqual(["browser", "subagents"])
  expect(issue.activePanelHidden).toBe(false)
})

test("captures Tool Dock visual check artifacts", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await enableDesktopWebFallback(page)
  await seedOversizedLayout(page, 1400)
  await fs.mkdir(artifactDir, { recursive: true })

  const captures: Awaited<ReturnType<typeof captureState>>[] = []
  let shrinkCapture: Awaited<ReturnType<typeof captureShrinkState>> | undefined

  await withSession(sdk, `visual check ${Date.now()}`, async (session) => {
    const child = await sdk.session
      .create({ parentID: session.id, agentID: "investigator", title: "Visual check child session" })
      .then((result) => result.data)
    if (!child?.id) throw new Error("Visual check could not create child session")

    try {
      await gotoSession(session.id)
      await openToolDock(page)

      const defaultSubagentsTab = page.getByRole("tab", { name: /Subagents/i }).first()
      await expect(defaultSubagentsTab).toBeVisible()
      await expect(defaultSubagentsTab).toHaveAttribute("aria-selected", "true")

      const defaultState = await collectToolDockState(page, "subagents")
      expect(defaultState.tabs.find((tab) => tab.value === "subagents")?.selected).toBe(true)
      expect(defaultState.tabs.find((tab) => tab.value === "review")?.exists).toBe(false)
      expect(defaultState.tabs.find((tab) => tab.value === "browser")?.exists).toBe(false)

      await restoreHiddenTool(page, /Review/i)
      await restoreHiddenTool(page, /Browser/i)

      for (const tab of toolTabs) {
        const trigger = page.getByRole("tab", { name: tab.label }).first()
        await expect(trigger).toBeVisible()
        await trigger.click()
        await expect(trigger).toHaveAttribute("aria-selected", "true")

        const capture = await captureState(page, tab)
        captures.push(capture)
        expect(capture.problems).toEqual({
          dockHidden: false,
          dockOutOfBounds: false,
          horizontalOverflow: false,
          missingTabs: [],
          missingPanels: [],
          activePanelHidden: false,
          inactiveVisible: [],
          selectedTabs: [tab.value],
          wrongSelection: false,
        })
      }

      const subagentsTab = page.getByRole("tab", { name: /Subagents/i }).first()
      await subagentsTab.click()
      await expect(subagentsTab).toHaveAttribute("aria-selected", "true")

      await page.setViewportSize({ width: 1180, height: 820 })
      await expect
        .poll(async () => {
          const issue = problems(await collectToolDockState(page, "subagents"))
          return !issue.dockOutOfBounds && !issue.horizontalOverflow && !issue.activePanelHidden
        })
        .toBe(true)

      shrinkCapture = await captureShrinkState(page)
      expect(shrinkCapture.problems).toMatchObject({
        dockHidden: false,
        dockOutOfBounds: false,
        horizontalOverflow: false,
        activePanelHidden: false,
        inactiveVisible: [],
      })
    } finally {
      await cleanupSession({ sdk, sessionID: child.id })
    }
  })

  const summary = {
    artifactDir,
    checkedAt: new Date().toISOString(),
    surface: "packages/app web renderer with desktop Tool Dock e2e fallback",
    safeMode: "e2e-local sandboxed backend; no user home/config writes; no provider secrets required",
    caveat: "Browser tab is rendered through the web fallback with a stubbed Electron webview; packaged Electron automation is not part of v1.",
    checkedTabs: captures.map((capture) => capture.tab),
    screenshots: captures.map((capture) => capture.screenshot),
    stateFiles: captures.map((capture) => path.join(artifactDir, `${capture.tab}.state.json`)),
    shrinkScenario: shrinkCapture
      ? {
          screenshot: shrinkCapture.screenshot,
          stateFile: path.join(artifactDir, "shrink.state.json"),
          viewport: shrinkCapture.state.viewport,
          dock: shrinkCapture.state.dock.rect,
        }
      : undefined,
  }

  await fs.writeFile(path.join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[visual-check] artifacts: ${artifactDir}`)
  console.log(`[visual-check] checked Tool Dock tabs: ${summary.checkedTabs.join(", ")}`)
})
