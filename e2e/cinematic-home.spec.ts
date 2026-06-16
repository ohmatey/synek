import { test, expect, type Page } from '@playwright/test'

// The cinematic stories-first home (docs/ux/cinematic-home.md). The signed-in
// dashboard is: a project rail (page-level filter via ?project=<slug>), a
// CONTAINED featured-story unit with ‹/› over recent stories, and "Your stories" /
// "Timelines" / "Brand kits" carousel rows. Story cards open an intro dialog;
// "Play story" deep-links into the reader and autostarts (?autoplay). The project
// view drops the featured unit and shows every group with an empty state.
//
// The seed (scripts/seed.ts) makes the demo account own ~6 public timelines, all
// with NO project and SEVERAL covered stories — so on a fresh account the rail
// shows only "New project" (no chips), the home leads with a featured story, and
// the stories + timelines rows render (no brand kits yet → no brand row on the
// all-scope home). Tests create their own projects to exercise filtering.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Timelines' })).toBeVisible()
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await expect(dialog).toBeHidden()
  // The dialog's onCreated syncs ?project=<slug>, but the page only resolves that
  // slug → active project once the ['projects'] query refetches. Wait for the rail
  // chip to land pressed so callers see the page actually filtered (not the
  // soft-fallback "All" scope during the refetch window).
  await expect(page).toHaveURL(/\?project=/)
  await expect(
    page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
}

test('the home shows the rail, the featured story unit, and the stories + timelines rows', async ({
  page,
}) => {
  await loginAsDemo(page)

  // The project rail is the page-level filter (always present + carries "New project").
  const rail = page.getByRole('navigation', { name: 'Projects' })
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button', { name: 'New project' })).toBeVisible()
  // Brand kits moved OUT of the bar to a row — no button in the rail anymore.
  await expect(rail.getByRole('button', { name: 'Brand kits' })).toHaveCount(0)

  // The featured-story unit (contained spotlight) with its primary actions.
  const featured = page.getByRole('region', { name: 'Featured story' })
  await expect(featured).toBeVisible()
  await expect(featured.getByRole('button', { name: 'Play story' })).toBeVisible()
  await expect(featured.getByRole('button', { name: 'Continue writing' })).toBeVisible()
  // The seed has several stories → the ‹/› pager is present.
  await expect(featured.getByRole('button', { name: 'Next story' })).toBeVisible()

  // Both content rows render once there's content.
  await expect(page.getByRole('region', { name: 'Your stories' })).toBeVisible()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow).toBeVisible()
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('the featured Play opens the story in the reader (with autoplay)', async ({ page }) => {
  await loginAsDemo(page)
  const featured = page.getByRole('region', { name: 'Featured story' })
  await featured.getByRole('button', { name: 'Play story' }).click()
  // Play routes to /timelines/$id?story=$storyId&autoplay=true — the in-app reader.
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
  await expect(page).toHaveURL(/autoplay=true/)
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

test('creating a project filters the page and shows per-group empty states (no hero)', async ({
  page,
}) => {
  await loginAsDemo(page)
  const name = `E2E Filter ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  await createProject(page, name)

  // The rail selected the fresh project → the page is scoped to it.
  await expect(page).toHaveURL(/\?project=/)
  const rail = page.getByRole('navigation', { name: 'Projects' })
  const chip = rail.getByRole('button', { name })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  // The project view drops the featured hero and shows every group with an empty
  // state (ask #8) — the seeded timelines stay null-project, so this project is bare.
  await expect(page.getByRole('region', { name: 'Featured story' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Your stories' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timelines' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Brand kits' })).toBeVisible()
  await expect(page.getByText(/No timelines yet/)).toBeVisible()
  await expect(page.getByText(/No stories yet/)).toBeVisible()
})

test('selecting "All" restores the full page (featured unit + populated rows)', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Select ${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await createProject(page, name)
  await expect(page.getByText(/No timelines yet/)).toBeVisible()

  // With 2+ projects the rail offers "All"; back to All → ?project drops and the
  // full page returns (featured unit + the populated Timelines row).
  const rail = page.getByRole('navigation', { name: 'Projects' })
  await rail.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page).not.toHaveURL(/\?project=/)
  await expect(page.getByRole('region', { name: 'Featured story' })).toBeVisible()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('the "Move to project" affordance moves a timeline into a project', async ({ page }) => {
  await loginAsDemo(page)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const target = `E2E Move Target ${stamp}`
  await createProject(page, `E2E Move Other ${stamp}`)
  await createProject(page, target)

  // Back to All so the seeded (movable) timelines are in view.
  const rail = page.getByRole('navigation', { name: 'Projects' })
  await rail.getByRole('button', { name: 'All', exact: true }).click()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow.getByRole('button', { name: 'Open “The Space Race”' })).toBeVisible()

  // Open the Space Race card's overflow menu → Move to project… → the target.
  await timelinesRow.getByRole('button', { name: 'Actions for “The Space Race”' }).click()
  await page.getByRole('menuitem', { name: 'Move to project…' }).click()
  await page.getByRole('menuitem', { name: target }).click()

  await expect(page.getByText(/“The Space Race”.*moved to/)).toBeVisible()

  // Proof it moved: filter to the target project and the Space Race timeline now
  // appears under its Timelines row (it didn't before — it was null-project).
  await rail.getByRole('button', { name: target }).click()
  await expect(page).toHaveURL(/\?project=/)
  const scopedRow = page.getByRole('region', { name: 'Timelines' })
  await expect(scopedRow.getByRole('button', { name: 'Open “The Space Race”' })).toBeVisible()
})
