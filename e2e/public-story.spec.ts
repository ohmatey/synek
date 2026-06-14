import { test, expect } from '@playwright/test'

// The sharable public story page (/s/$slug). The seeded `stoicism` timeline is
// public and its flagship story carries a pinned slug ('from-shipwreck-to-throne')
// plus three live widgets — an entity card (beat 1), a globe (beat 2), and a
// timeline strip (beat 6). No login: the public page is anonymous-readable.
// Reduced motion so the Reels reader doesn't auto-advance — the step-through is
// deterministic and exercises the manual Next control.
test.use({ reducedMotion: 'reduce' })

const SLUG = 'from-shipwreck-to-throne'

test('the public page renders the cover, OpenGraph tags, and a live stamp', async ({ page }) => {
  await page.goto(`/s/${SLUG}`)

  // SSR head: title + OG image carry the story into link unfurls.
  await expect(page).toHaveTitle(/From a shipwreck to the throne · Synek/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'From a shipwreck to the throne')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /.+/)
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')

  // The cover: brand chrome, title, hook, the live "updated" stamp, and Play.
  await expect(page.getByText('Synek', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'From a shipwreck to the throne' })).toBeVisible()
  await expect(page.getByText(/lost cargo became an emperor’s creed/)).toBeVisible()
  await expect(page.getByText(/Updated/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
})

test('stepping through plays the three live widgets', async ({ page }) => {
  await page.goto(`/s/${SLUG}`)
  await page.getByRole('button', { name: 'Play story' }).click()

  // Beat 1 — the entity card widget (the place it began).
  await expect(page.getByText('1 / 6')).toBeVisible()
  await expect(page.locator('.wg-entity')).toBeVisible()
  await expect(page.locator('.wg-entity-title')).toHaveText('The Stoa Poikile')

  // Beat 2 — the globe widget (lazy + client-only). Step forward and wait for it.
  await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('2 / 6')).toBeVisible()
  await expect(page.locator('.wg-globe-svg')).toBeVisible()
  await expect(page.getByText(/From Cyprus to Rome/)).toBeVisible()

  // Beat 6 — the timeline strip widget (focus on the Roman Stoa).
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('6 / 6')).toBeVisible()
  await expect(page.locator('.wg-timeline-svg')).toBeVisible()
  await expect(page.getByText(/Three Stoas across five centuries/)).toBeVisible()
})

test('the end panel closes the growth loop with a make-your-own CTA', async ({ page }) => {
  await page.goto(`/s/${SLUG}`)
  await page.getByRole('button', { name: 'Play story' }).click()

  // Step past the last beat → the end panel.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('The end', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Make your own with Synek/ })).toBeVisible()
})

test('an unknown slug renders a clean not-found, not a crash', async ({ page }) => {
  await page.goto('/s/this-story-does-not-exist')
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible()
})
