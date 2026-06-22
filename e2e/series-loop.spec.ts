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

test('a SeriesCard "View series" link opens the in-app series detail (slice B)', async ({ page }) => {
  await loginAsDemo(page)

  // The secondary "View series" link goes to the creator workspace (/series/$id);
  // the card's primary action still points at the public season.
  const view = page.getByRole('link', { name: /^View .* in your workspace$/ }).first()
  await expect(view).toBeVisible()
  await view.click()

  await expect(page).toHaveURL(/\/series\//)
  // The jacket renders (some series title as the page heading) + the spine.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible()
  // The frontier line + the primary "Write the next chapter" CTA.
  await expect(page.getByText(/Frontier:|No chapters yet/)).toBeVisible()
  const write = page.getByRole('button', { name: 'Write the next chapter' })
  await expect(write).toBeVisible()

  // The CTA opens the same paste-ready prompt as the card.
  await write.click()
  const dialog = page.getByRole('dialog', { name: 'Write the next chapter' })
  await expect(dialog.getByText(/appendToSeries/)).toBeVisible()
})
