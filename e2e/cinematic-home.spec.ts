import { test, expect, type Page } from '@playwright/test'

// The signed-in workspace at the root `/` (Synek is a pure app — no landing page
// or public Explore feed; per-story sharing lives at /s/$slug). Two modes: the
// LIST page (a projects grid + aggregate "Your stories" / "Timelines" rows) and a
// PROJECT page (?project=<slug>: that project's hero + rows). Signing in lands here.
//
// The seed (scripts/seed.ts) makes the demo account own ~6 public timelines, all
// with NO project and SEVERAL covered (now public) stories — so the list page
// shows the default project in the grid, populated stories + timelines rows, and
// no brand row yet. Tests create their own projects to exercise the project view.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Login lands on the workspace at the root `/`; the "Timelines" row heading is
  // the stable marker.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Timelines' })).toBeVisible()
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

test('the workspace shows the projects grid and the stories + timelines rows', async ({ page }) => {
  await loginAsDemo(page)

  // The Projects grid is the list page's headline (carries "New project").
  const projects = page.getByRole('region', { name: 'Projects' })
  await expect(projects).toBeVisible()
  await expect(projects.getByRole('button', { name: 'New project' })).toBeVisible()

  // The header Projects button is the new nav affordance (replaced the sidebar).
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()

  // Both content rows render once there's content.
  await expect(page.getByRole('region', { name: 'Your stories' })).toBeVisible()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow).toBeVisible()
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('clicking a story card opens its intro dialog with a Play story action', async ({ page }) => {
  await loginAsDemo(page)
  const stories = page.getByRole('region', { name: 'Your stories' })
  await stories.getByRole('button', { name: /^Open / }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Play story' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Continue writing' })).toBeVisible()
})

test('the story card Play opens the story in the reader (with autoplay)', async ({ page }) => {
  await loginAsDemo(page)
  const stories = page.getByRole('region', { name: 'Your stories' })
  await stories.getByRole('button', { name: 'Play' }).first().click()
  // Play routes to /timelines/$id?story=$storyId&autoplay=true — the in-app reader.
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
  await expect(page).toHaveURL(/autoplay=true/)
})

test('creating a project enters its page — project hero + per-group empty states', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Filter ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  await createProject(page, name)

  // Entering a project shows ITS OWN hero (not the projects grid) and every group
  // with an empty state — the seeded timelines stay null-project, so it's bare.
  await expect(page.getByRole('region', { name: `Project: ${name}` })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Projects' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Your stories' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timelines' })).toBeVisible()
  // Theme + brand voice are built into the project now (the hero's "Customize"),
  // not a separate "Brand kits" row.
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible()
  await expect(page.getByText(/No timelines yet/)).toBeVisible()
  await expect(page.getByText(/No stories yet/)).toBeVisible()
})

test('the header Projects button returns to the list (grid + populated rows)', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Select ${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await createProject(page, name)
  await expect(page.getByText(/No timelines yet/)).toBeVisible()

  // The header's Projects button drops ?project and returns to the list page.
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page).not.toHaveURL(/\?project=/)
  await expect(page.getByRole('region', { name: 'Projects' })).toBeVisible()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('the "Move to project" affordance moves a timeline into a project', async ({ page }) => {
  await loginAsDemo(page)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const target = `E2E Move Target ${stamp}`
  await createProject(page, `E2E Move Other ${stamp}`)
  await createProject(page, target)

  // Back to the list so the seeded (movable) timelines are in view.
  await page.getByRole('link', { name: 'Projects' }).click()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow.getByRole('button', { name: 'Open “The Space Race”' })).toBeVisible()

  // Open the Space Race card's overflow menu → Move to project… → the target.
  await timelinesRow.getByRole('button', { name: 'Actions for “The Space Race”' }).click()
  await page.getByRole('menuitem', { name: 'Move to project…' }).click()
  await page.getByRole('menuitem', { name: target }).click()

  await expect(page.getByText(/“The Space Race”.*moved to/)).toBeVisible()

  // Proof it moved: enter the target project and the Space Race timeline now appears
  // under its Timelines row (it didn't before — it was null-project). Reach the
  // project via its card in the grid.
  await page.getByRole('link', { name: 'Projects' }).click()
  await page.getByRole('link', { name: `Open project “${target}”` }).click()
  await expect(page).toHaveURL(/\?project=/)
  const scopedRow = page.getByRole('region', { name: 'Timelines' })
  await expect(scopedRow.getByRole('button', { name: 'Open “The Space Race”' })).toBeVisible()
})
