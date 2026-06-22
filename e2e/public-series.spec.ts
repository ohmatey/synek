import { test, expect } from '@playwright/test'

// The sharable public SERIES page (/sr/$slug) — the "season" reader (ADR 0006).
// The seeded `roman-republic` timeline carries a public series with a pinned slug
// ('the-fall-of-the-republic') and two chapters: "The road to the Ides" (5 beats)
// then "After the Ides". No login — the public page is anonymous-readable. Reduced
// motion so the Reels reader doesn't auto-advance; the step-through is deterministic.
test.use({ reducedMotion: 'reduce' })

const SLUG = 'the-fall-of-the-republic'
const CH1_BEATS = 5

test('the season page renders OpenGraph, the chapter rail, and chapter one', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)

  // SSR head: title + OG carry the season into link unfurls.
  await expect(page).toHaveTitle(/The Fall of the Republic · Synek/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'The Fall of the Republic')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /.+/)

  // The chapter rail lists both chapters in order; the reader mounts on chapter one.
  const rail = page.getByRole('navigation', { name: /Chapters of The Fall of the Republic/ })
  await expect(rail.getByRole('button', { name: /The road to the Ides/ })).toBeVisible()
  await expect(rail.getByRole('button', { name: /After the Ides/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The road to the Ides' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
})

test('finishing a chapter offers "Next chapter", which advances in order', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)
  await page.getByRole('button', { name: 'Play story' }).click()

  // Step past chapter one's last beat → the end-of-chapter panel (not the
  // make-your-own CTA, because a next chapter exists).
  for (let i = 0; i < CH1_BEATS; i++) await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('End of chapter', { exact: true })).toBeVisible()
  const next = page.getByRole('button', { name: 'Next chapter' })
  await expect(next).toBeVisible()

  // Advancing lands on chapter two, freshly on its cover.
  await next.click()
  await expect(page.getByRole('heading', { name: 'After the Ides' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
})

test('the chapter rail jumps straight to a later chapter', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)
  const rail = page.getByRole('navigation', { name: /Chapters of The Fall of the Republic/ })
  await rail.getByRole('button', { name: /After the Ides/ }).click()
  await expect(page.getByRole('heading', { name: 'After the Ides' })).toBeVisible()
})

test('an unknown series slug renders a clean not-found, not a crash', async ({ page }) => {
  await page.goto('/sr/this-series-does-not-exist')
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible()
})
