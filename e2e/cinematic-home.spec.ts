import { test, expect, type Page } from '@playwright/test'

// The signed-in workspace at `/` (ADR 0007 — Synek is stories-first; projects are
// invisible plumbing with NO UI surfaces). The populated home leads with a cinematic
// featured-story hero, then a "Create" action bar (New story / series / timeline), a
// time-sorted "Recently updated" feed (stories + timelines), a Series row, a Timelines
// row, and a demoted entities disclosure. Brands live in the profile menu.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Login lands on the workspace at `/`; the "Your library" bar is the populated-home
  // marker (the demo account owns seeded stories/timelines).
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Create' })).toBeVisible()
}

test('the home leads with the library bar + a Recently updated feed, with no project surfaces', async ({ page }) => {
  await loginAsDemo(page)

  // No project surfaces anywhere (ADR 0007).
  await expect(page.getByRole('region', { name: 'Projects' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Projects' })).toHaveCount(0)

  // The create bar leads with story-first creation (brands live in the profile menu).
  const lib = page.getByRole('region', { name: 'Create' })
  await expect(lib.getByRole('button', { name: 'New story' })).toBeVisible()
  await expect(lib.getByRole('button', { name: 'New series' })).toBeVisible()
  await expect(lib.getByRole('button', { name: 'Brand kits' })).toHaveCount(0)

  // The time-sorted feed surfaces the seeded timelines as poster links.
  const recent = page.getByRole('region', { name: 'Recently updated' })
  await expect(recent).toBeVisible()
  await expect(recent.getByRole('link', { name: 'Open timeline “Figures of science”' })).toBeVisible()
})

test('the populated home leads with a featured-story hero above the Create bar', async ({ page }) => {
  await loginAsDemo(page)
  // The cinematic banner (design Principle 2: gravity at the top) — the owner's most
  // recently updated story, with Play (autoplay) + Read (open on cover) CTAs.
  const hero = page.getByRole('region', { name: /^Featured story:/ })
  await expect(hero).toBeVisible()
  await expect(hero.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(hero.getByRole('button', { name: 'Read' })).toBeVisible()
  // Play deep-links into the in-app reader with autoplay.
  await hero.getByRole('button', { name: 'Play' }).click()
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
})

test('clicking a recent story card opens the in-app reader', async ({ page }) => {
  await loginAsDemo(page)
  const recent = page.getByRole('region', { name: 'Recently updated' })
  await recent.getByRole('link', { name: /^Open story / }).first().click()
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
})

test('a recent story card restores Play + the overflow actions', async ({ page }) => {
  await loginAsDemo(page)
  const recent = page.getByRole('region', { name: 'Recently updated' })
  const card = recent.getByRole('article').filter({ has: page.getByRole('link', { name: /^Open story / }) }).first()
  await expect(card.getByRole('button', { name: 'Play' })).toBeVisible()
  await card.getByRole('button', { name: /^Actions for / }).click()
  await expect(page.getByRole('menuitem', { name: 'Continue writing' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Share' })).toBeVisible()
})

test('the entities disclosure reveals the entity grid on demand', async ({ page }) => {
  await loginAsDemo(page)
  const toggle = page.getByRole('button', { name: /People, places & ideas/ })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('the Brand kits library (in the profile menu) lists and creates a brand', async ({ page }) => {
  await loginAsDemo(page)
  // Brand kits moved out of the create bar into the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Brand kits' }).click()
  // The dialog's title flips to "Edit brand" inside the editor, so locate it unnamed.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Brand kits' })).toBeVisible()
  // Creating a brand drops into the editor seeded with a default name.
  await dialog.getByRole('button', { name: 'New brand', exact: true }).click()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('New brand')
})
