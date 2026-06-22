import { test, expect, type Page } from '@playwright/test'

// The in-app next-chapter loop (creator side). The headline action — "Write the
// next chapter" — lives on each SeriesCard in the signed-in workspace: it opens the
// shared PromptDialog with a ready-to-paste prompt for the connected Claude (the app
// holds no AI; copy-only until a per-series Run target is wired). The seed makes the
// demo account own public series (e.g. "The Fall of the Republic"), so the Series
// row renders on the list page at `/`.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('a SeriesCard offers "Write the next chapter", which opens the paste-ready prompt', async ({ page }) => {
  await loginAsDemo(page)

  // The Series row renders on the list page (demo owns seeded series).
  const writeBtn = page.getByRole('button', { name: /^Write the next chapter of/ }).first()
  await expect(writeBtn).toBeVisible()
  await writeBtn.click()

  // The shared PromptDialog opens with the next-chapter instructions.
  const dialog = page.getByRole('dialog', { name: 'Write the next chapter' })
  await expect(dialog).toBeVisible()
  // The prompt tells the connected Claude to read the watermark and append a chapter.
  await expect(dialog.getByText(/get_series/)).toBeVisible()
  await expect(dialog.getByText(/appendToSeries/)).toBeVisible()
  // Copy-only (no Run): the local-first default action is present.
  await expect(dialog.getByRole('button', { name: /Copy prompt/ })).toBeVisible()
})
