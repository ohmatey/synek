import { test, expect, type Page } from '@playwright/test'

// The signed-in workspace at the root `/` (Synek is a pure app — no landing page
// or public Explore feed; per-story sharing lives at /s/$slug). Reorganized around
// TIME rather than object type: two modes share the same two sections —
//   • LIST page (no ?project): the PROJECTS grid + a "Recently updated" feed
//     (stories + timelines, most-recent first) + a demoted entities disclosure.
//   • PROJECT page (?project=<slug>): that project's hero + its TIMELINES grid +
//     the same "Recently updated" feed (scoped).
// Signing in lands on the list page.
//
// The seed (scripts/seed.ts) makes the demo account own ~6 public timelines, all
// with NO project and SEVERAL covered (now public) stories — so the list page
// shows the default project in the grid and those timelines/stories in the feed.
// Tests create their own projects to exercise the project view.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Login lands on the workspace at the root `/`; the "Projects" grid heading is
  // the stable list-page marker (every owner has ≥1 project).
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

async function createProject(page: Page, name: string) {
  // "New project" lives on the list page (the projects grid), so make sure we're
  // there — a previous create may have left us inside a project view.
  await page.goto('/')
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await expect(dialog).toBeHidden()
  // onCreated navigates to /?project=<slug>; the page resolves that slug to
  // the active project once ['projects'] refetches → its ProjectHero lands.
  await expect(page).toHaveURL(/\?project=/)
  await expect(page.getByRole('region', { name: `Project: ${name}` })).toBeVisible()
}

test('the list page shows the projects grid and a Recently updated feed', async ({ page }) => {
  await loginAsDemo(page)

  // The Projects grid is the list page's section 1 (carries "New project").
  const projects = page.getByRole('region', { name: 'Projects' })
  await expect(projects).toBeVisible()
  await expect(projects.getByRole('button', { name: 'New project' })).toBeVisible()

  // The header Projects button is the nav affordance (replaced the sidebar).
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()

  // Section 2 — the time-sorted feed surfaces the seeded timelines (as poster
  // links), replacing the old per-type "Your stories" / "Timelines" carousels.
  const recent = page.getByRole('region', { name: 'Recently updated' })
  await expect(recent).toBeVisible()
  await expect(recent.getByRole('link', { name: 'Open timeline “Figures of science”' })).toBeVisible()
})

test('clicking a recent story card opens the in-app reader', async ({ page }) => {
  await loginAsDemo(page)
  const recent = page.getByRole('region', { name: 'Recently updated' })
  // A story card in the feed is a quick-jump link straight into the docked reader
  // (the old intro dialog + Play affordance moved off the home).
  await recent.getByRole('link', { name: /^Open story / }).first().click()
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
})

test('a recent story card restores Play + the overflow actions', async ({ page }) => {
  await loginAsDemo(page)
  const recent = page.getByRole('region', { name: 'Recently updated' })
  const card = recent.getByRole('article').filter({ has: page.getByRole('link', { name: /^Open story / }) }).first()
  // Footer Play stays a one-tap affordance; the overflow restores the rest.
  await expect(card.getByRole('button', { name: 'Play' })).toBeVisible()
  await card.getByRole('button', { name: /^Actions for / }).click()
  await expect(page.getByRole('menuitem', { name: 'Continue writing' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Share' })).toBeVisible()
})

test('the entities disclosure reveals the entity grid on demand', async ({ page }) => {
  await loginAsDemo(page)
  // Entities are demoted from a top-level row to an opt-in disclosure under the feed.
  const toggle = page.getByRole('button', { name: /People, places & ideas/ })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('creating a project enters its page — project hero + empty timelines', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Filter ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  await createProject(page, name)

  // Entering a project shows ITS OWN hero (not the projects grid) and a Timelines
  // section with an empty state — the seeded timelines stay null-project, so it's bare.
  await expect(page.getByRole('region', { name: `Project: ${name}` })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Projects' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Timelines' })).toBeVisible()
  // Theme + brand voice are built into the project now (the hero's "Customize").
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible()
  await expect(page.getByText(/No timelines yet/)).toBeVisible()
})

test('the header Projects button returns to the list (grid + feed)', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Select ${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await createProject(page, name)
  await expect(page.getByText(/No timelines yet/)).toBeVisible()

  // The header's Projects button drops ?project and returns to the list page.
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page).not.toHaveURL(/\?project=/)
  await expect(page.getByRole('region', { name: 'Projects' })).toBeVisible()
  const recent = page.getByRole('region', { name: 'Recently updated' })
  await expect(recent.getByRole('link', { name: 'Open timeline “Figures of science”' })).toBeVisible()
})

test('the "Move to project" affordance moves a timeline between projects', async ({ page }) => {
  await loginAsDemo(page)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const source = `E2E Move Src ${stamp}`
  const target = `E2E Move Target ${stamp}`
  await createProject(page, source)
  await createProject(page, target)

  // A timeline is managed from WITHIN its project now (the list page no longer
  // lists individual timeline cards). Create one inside the source project.
  await page.goto('/')
  await page.getByRole('link', { name: `Open project “${source}”` }).click()
  await expect(page).toHaveURL(/\?project=/)
  const timelines = page.getByRole('region', { name: 'Timelines' })
  await timelines.getByRole('button', { name: 'New timeline' }).click()
  const dialog = page.getByRole('dialog')
  const tlName = `E2E Movable ${stamp}`
  await dialog.getByLabel('Name', { exact: true }).fill(tlName)
  await dialog.getByRole('button', { name: 'Create timeline' }).click()
  // Close the "ready" step (don't open the canvas) to stay on the project page.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // The new timeline now lives in the source project's Timelines grid.
  await expect(timelines.getByRole('button', { name: `Open “${tlName}”` })).toBeVisible()

  // Move it to the target project via its overflow menu.
  await timelines.getByRole('button', { name: `Actions for “${tlName}”` }).click()
  await page.getByRole('menuitem', { name: 'Move to project…' }).click()
  await page.getByRole('menuitem', { name: target }).click()
  await expect(page.getByText(new RegExp(`“${tlName}”.*moved to`))).toBeVisible()

  // Proof it moved: enter the target project and the timeline now appears there.
  await page.goto('/')
  await page.getByRole('link', { name: `Open project “${target}”` }).click()
  const targetTimelines = page.getByRole('region', { name: 'Timelines' })
  await expect(targetTimelines.getByRole('button', { name: `Open “${tlName}”` })).toBeVisible()
})
