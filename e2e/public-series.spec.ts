import { test, expect } from '@playwright/test'
import { assertTopAligned } from './helpers/layout-invariants'
import { expectNoA11yViolations } from './helpers/a11y'

// The sharable public SERIES page (/sr/$slug) — the "evolving book" season reader
// (ADR 0006 + local-162). The seeded `roman-republic` timeline carries a public
// series with a pinned slug ('the-fall-of-the-republic') and two chapters: "The road
// to the Ides" (5 beats) then "After the Ides". No login — anonymous-readable.
//
// The page is a TWO-PANEL reading surface: a chapter rail (jacket + spine) pinned
// beside the reader on desktop, an overlay sheet on mobile. There is ONE start CTA —
// "Begin reading" on the jacket; the reader's own cover play button is suppressed, so
// picking a chapter (jacket CTA or a spine row) swaps the reader and starts playback.
// Reduced motion so the Reels reader doesn't auto-advance; the step-through is
// deterministic.
test.use({ reducedMotion: 'reduce' })

const SLUG = 'the-fall-of-the-republic'
const CH1_BEATS = 5

test('the season page renders OpenGraph, the jacket, the spine, and chapter one', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)

  // Layout/scroll invariants (foundry visual-testing Technique 1): the jacket hero
  // must be in the viewport and the page must load at scrollY 0 with a single <h1>.
  // The two-panel surface keeps the rail + reader within one viewport, so there is no
  // tall stack to scroll past on mount.
  await assertTopAligned(page)

  // Accessibility pass (Technique 2): no structural/ARIA violations on the public
  // reader. `color-contrast` is enforced too — themed accents flow through the
  // readable --color-accent-*-text / --color-on-* tokens, so AA holds on page code.
  // axe also guards landmarks, roles, alt text, and heading order (catches a double <h1>).
  await expectNoA11yViolations(page)

  // SSR head: title + OG carry the season into link unfurls.
  await expect(page).toHaveTitle(/The Fall of the Republic · Synek/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'The Fall of the Republic')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /.+/)

  // The jacket: the series title as the page heading + the SINGLE "Begin reading" CTA.
  await expect(page.getByRole('heading', { name: 'The Fall of the Republic' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin reading' })).toBeVisible()

  // The spine (table of contents) lists both chapters in order. On desktop it is
  // pinned inline in the rail (no toggle needed).
  const spine = page.getByRole('navigation', { name: 'Table of contents' })
  await expect(spine.getByRole('button', { name: /Chapter 1: The road to the Ides/ })).toBeVisible()
  await expect(spine.getByRole('button', { name: /Chapter 2: After the Ides/ })).toBeVisible()

  // The reader mounts on chapter one's opener (its <h2>), but with NO competing start
  // button — the jacket "Begin reading" is the only CTA.
  await expect(page.getByRole('heading', { name: 'The road to the Ides' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin chapter' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play story' })).toHaveCount(0)
})

test('"Begin reading" starts chapter one in the reader', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)
  await page.getByRole('button', { name: 'Begin reading' }).click()

  // Playback begins on chapter one's first beat; the in-reader step control appears.
  await expect(page.getByText(/It started in Gaul/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next beat' })).toBeVisible()
})

test('finishing a chapter offers "Next chapter", which advances in order', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)
  await page.getByRole('button', { name: 'Begin reading' }).click()

  // Step past chapter one's last beat → the end-of-chapter panel (not the
  // make-your-own CTA, because a next chapter exists).
  for (let i = 0; i < CH1_BEATS; i++) await page.getByRole('button', { name: 'Next beat' }).click()
  await expect(page.getByText('End of Chapter 1', { exact: true })).toBeVisible()
  const next = page.getByRole('button', { name: 'Next chapter' })
  await expect(next).toBeVisible()

  // Advancing swaps to chapter two and plays it in order (the cover CTA is suppressed,
  // so the reader opens straight on chapter two's first beat).
  await next.click()
  await expect(page.getByText(/The conspirators expected to be hailed as liberators/)).toBeVisible()
})

test('a spine row opens a later chapter on its opener; the jacket starts it', async ({ page }) => {
  await page.goto(`/sr/${SLUG}`)
  const spine = page.getByRole('navigation', { name: 'Table of contents' })
  await spine.getByRole('button', { name: /Chapter 2: After the Ides/ }).click()

  // Picking a chapter PREVIEWS it on the opener (its <h2>) — not mid-playback.
  await expect(page.getByRole('heading', { name: 'After the Ides' })).toBeVisible()
  await expect(page.getByText(/The conspirators expected to be hailed as liberators/)).toHaveCount(0)

  // The single jacket CTA (now "Continue reading", since a later chapter is selected)
  // starts the previewed chapter.
  await page.getByRole('button', { name: 'Continue reading' }).click()
  await expect(page.getByText(/The conspirators expected to be hailed as liberators/)).toBeVisible()
})

test('on mobile the spine is an overlay sheet behind a "Chapters" toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/sr/${SLUG}`)

  // The spine is hidden by default; the jacket carries a "Chapters" toggle.
  const spine = page.getByRole('navigation', { name: 'Table of contents' })
  await expect(spine).not.toBeVisible()
  const toggle = page.getByRole('button', { name: /^Chapters \(/ })
  await expect(toggle).toBeVisible()

  // Opening the sheet reveals the chapter list; picking a chapter closes the sheet and
  // previews that chapter on its opener; the jacket CTA then starts it.
  await toggle.click()
  await expect(spine).toBeVisible()
  await spine.getByRole('button', { name: /Chapter 2: After the Ides/ }).click()
  await expect(spine).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'After the Ides' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue reading' }).click()
  await expect(page.getByText(/The conspirators expected to be hailed as liberators/)).toBeVisible()
})

test('an unknown series slug renders a clean not-found, not a crash', async ({ page }) => {
  await page.goto('/sr/this-series-does-not-exist')
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible()
})
