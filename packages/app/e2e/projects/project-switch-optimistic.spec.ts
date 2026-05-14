import { test, expect } from "../fixtures"
import { cleanupTestProject, createTestProject, openSidebar, sessionIDFromUrl } from "../actions"
import { projectSwitchSelector, promptSelector } from "../selectors"
import { dirSlug } from "../utils"

test("keeps optimistic prompt visible when project-switch history sync is stale", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })

  let messageFetches = 0
  await page.route("**/session/*/message?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    messageFetches++
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route("**/session/*/prompt_async", (route) => route.fulfill({ status: 204, body: "" }))

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ trackSession }) => {
        await openSidebar(page)
        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()
        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session(?:[/?#]|$)`))

        const prompt = page.locator(promptSelector)
        const token = `optimistic race ${Date.now()}`
        await expect(prompt).toBeVisible()
        await prompt.fill(token)
        await page.keyboard.press("Enter")

        await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 15_000 })
        const created = sessionIDFromUrl(page.url())
        if (!created) throw new Error(`Failed to get session ID from url: ${page.url()}`)
        trackSession(created, other)

        const optimistic = page.getByText(token).first()
        await expect(optimistic).toBeVisible()
        await expect.poll(() => messageFetches, { timeout: 10_000 }).toBeGreaterThan(0)
        await expect(optimistic).toBeVisible()

        expect(errors.filter((error) => error.includes("untrack") || error.includes("TypeError"))).toEqual([])
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
