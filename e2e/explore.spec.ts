import { test, expect } from '@playwright/test'

// The root `/` is the public Explore feed — a cross-user discovery surface shown
// to everyone (it replaced the marketing landing). The seed makes the demo
// account own ~6 PUBLIC timelines with public stories + many nodes, so the feed's
// three rows (Stories / Timelines / Notable entities) all populate without login.
test.use({ reducedMotion: 'reduce' })

test('the root shows the public explore feed with stories, timelines and entities', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Public stories, timelines and ideas' })).toBeVisible()

  // Signed out: the header offers a Sign-in entry point, not the Projects button.
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Projects' })).toHaveCount(0)

  // All three public rows render from the seeded public content.
  await expect(page.getByRole('region', { name: 'Stories' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timelines' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Notable entities' })).toBeVisible()
})

test('a public story card opens the sharable reader at /s/$slug', async ({ page }) => {
  await page.goto('/')
  const stories = page.getByRole('region', { name: 'Stories' })
  await stories.getByRole('link', { name: /^Read / }).first().click()
  await expect(page).toHaveURL(/\/s\//)
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
})

test('a public timeline card opens the canvas (anonymous)', async ({ page }) => {
  await page.goto('/')
  const timelines = page.getByRole('region', { name: 'Timelines' })
  await timelines.getByRole('link', { name: /^Open / }).first().click()
  await expect(page).toHaveURL(/\/timelines\//)
})

test('signed in, the header gains the Projects button', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/projects/)

  // Back to the root Explore feed — now the header carries Projects (→ workspace).
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Public stories, timelines and ideas' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()
})
