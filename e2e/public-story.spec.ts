import { test, expect } from '@playwright/test'
import { assertTopAligned } from './helpers/layout-invariants'
import { expectNoA11yViolations } from './helpers/a11y'

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

  // Layout/scroll invariants (foundry visual-testing Technique 1): the cover hero is
  // in the viewport, the page loads at scrollY 0, and there is exactly one <h1> (the
  // story title). The Reels reader focus()es its root on mount — this guards that it
  // doesn't auto-scroll the page past the cover, plus the off-screen / double-h1 class.
  await assertTopAligned(page)

  // Accessibility pass (Technique 2): no structural/ARIA violations on the public
  // reader — landmarks, roles, alt text, heading order (catches a double <h1>), and
  // color-contrast (the reader's accent text flows through the readable
  // --color-accent-*-text / --color-on-* tokens, so AA holds against page code).
  await expectNoA11yViolations(page)

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

test('the end panel closes the growth loop with an attributed make-your-own CTA', async ({ page }) => {
  await page.goto(`/s/${SLUG}`)
  await page.getByRole('button', { name: 'Play story' }).click()

  // Step past the last beat → the end panel.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('The end', { exact: true })).toBeVisible()

  // M.4: the CTA carries this story's slug into /signup so the resulting signup is
  // joined back to the share (the viral-coefficient numerator).
  const cta = page.getByRole('link', { name: /Make your own with Synek/ })
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute('href', `/signup?ref=story&slug=${SLUG}`)
})

test('the attributed signup link opens a working signup form', async ({ page }) => {
  // Following the M.4 CTA must land on a real signup screen (the route accepts the
  // ref/slug params and renders, never 404s).
  await page.goto(`/signup?ref=story&slug=${SLUG}`)
  await expect(page.getByText('Create your account')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
})

test('an unknown slug renders a clean not-found, not a crash', async ({ page }) => {
  await page.goto('/s/this-story-does-not-exist')
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible()
})
