import { test, expect, type Page } from '@playwright/test'

// The cinematic stories-first home (docs/ux/cinematic-home.md / PRD local-127),
// slice 1 of the Projects pivot (ADR 0002). The signed-in dashboard is a project
// rail (page-level filter via ?project=<slug>) + a full-bleed cinematic hero
// (featured story) + "Your stories" and "Timelines" carousel rows. The Projects
// data/server/MCP spine is already built + verified (verify:projects); these are
// the UI-level integration checks.
//
// The seed (scripts/seed.ts) makes the demo account own ~6 public timelines, all
// with NO project (projectId stays null) and SEVERAL covered stories — so on a
// fresh account the rail shows only the "New project" affordance (no chips yet),
// the hero leads with a covered story, and both rows render. Tests create their
// own projects to exercise filtering + the move affordance.
//
// Reduced motion keeps the carousels' scroll deterministic (the global styles.css
// reset collapses smooth scroll to instant under prefers-reduced-motion).
test.use({ reducedMotion: 'reduce' })

// Sign in as the seeded demo account via /login (mirrors home.spec.ts). The
// "Timelines" carousel heading is the stable signed-in marker (landing→dashboard
// swap done, session resolved).
async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Timelines' })).toBeVisible()
}

// Create a project through the rail's NewProjectDialog and wait for the rail to
// select it (the dialog's onCreated syncs ?project=<slug>). Returns nothing — the
// caller asserts on the URL / rail. A timestamped name keeps tests independent
// under fullyParallel (they share one demo account + e2e.db).
async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await expect(dialog).toBeHidden()
}

test('the signed-in home shows the project rail, a cinematic hero, and the stories + timelines rows', async ({
  page,
}) => {
  await loginAsDemo(page)

  // The project rail is the page-level filter (always present, always carries the
  // "New project" affordance even on day one with zero projects).
  const rail = page.getByRole('navigation', { name: 'Projects' })
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button', { name: 'New project' })).toBeVisible()

  // The cinematic hero: the seed has covered stories, so the home leads with a
  // featured-story poster (aria-label="Featured story") + a Play story CTA.
  const hero = page.getByRole('region', { name: 'Featured story' })
  await expect(hero).toBeVisible()
  await expect(hero.getByRole('button', { name: 'Play story' })).toBeVisible()
  await expect(hero.getByRole('button', { name: 'Continue writing' })).toBeVisible()

  // Both carousel rows render once there's content.
  await expect(page.getByRole('region', { name: 'Your stories' })).toBeVisible()
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow).toBeVisible()
  // The seeded timelines surface as open-cards in the Timelines row.
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('the hero Play opens the featured story in the reader', async ({ page }) => {
  await loginAsDemo(page)
  const hero = page.getByRole('region', { name: 'Featured story' })
  await hero.getByRole('button', { name: 'Play story' }).click()
  // Play routes to /timelines/$id?story=$storyId — the in-app reader on the canvas.
  await expect(page).toHaveURL(/\/timelines\/[^/]+\?.*story=/)
})

test('creating a project (NewProjectDialog) adds a rail chip and filters the page to it', async ({ page }) => {
  await loginAsDemo(page)
  const name = `E2E Filter ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  await createProject(page, name)

  // The rail selected the fresh project (its slug → ?project), so the page is now
  // scoped to it. The new chip is present + pressed.
  await expect(page).toHaveURL(/\?project=/)
  const rail = page.getByRole('navigation', { name: 'Projects' })
  const chip = rail.getByRole('button', { name })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  // A brand-new project is empty: the seeded timelines stay null-project, so the
  // project-filter narrows the page to nothing → the empty-project hero, and the
  // Timelines row is gone. This proves the rail actually re-scopes the page.
  await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible()
  await expect(page.getByText(`“${name}” is empty.`)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timelines' })).toHaveCount(0)
})

test('selecting a project chip filters; selecting "All" restores the full page', async ({ page }) => {
  await loginAsDemo(page)
  // Need a project to filter to — make one (it lands selected + empty).
  const name = `E2E Select ${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await createProject(page, name)

  // Scoped to the empty project → no Timelines row.
  await expect(page.getByText(`“${name}” is empty.`)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timelines' })).toHaveCount(0)

  // With 2+ projects the rail offers "All"; back to All → ?project drops and the
  // full (null-project + all) page returns, Timelines row and all.
  const rail = page.getByRole('navigation', { name: 'Projects' })
  await rail.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page).not.toHaveURL(/\?project=/)
  const timelinesRow = page.getByRole('region', { name: 'Timelines' })
  await expect(timelinesRow).toBeVisible()
  await expect(timelinesRow.getByRole('button', { name: 'Open “Figures of science”' })).toBeVisible()
})

test('the "Move to project" affordance moves a timeline into a project', async ({ page }) => {
  await loginAsDemo(page)

  // The move submenu only renders with 2+ projects (a single-project owner has
  // nowhere to move to). Create one as the move TARGET; a second guarantees the
  // submenu is present regardless of any other test's leftovers.
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

  // The move toast confirms (it names the timeline + the destination project).
  await expect(page.getByText(/“The Space Race”.*moved to/)).toBeVisible()

  // Proof it actually moved: filter to the target project and the Space Race
  // timeline now appears under it (it didn't before — it was null-project).
  await rail.getByRole('button', { name: target }).click()
  await expect(page).toHaveURL(/\?project=/)
  const scopedRow = page.getByRole('region', { name: 'Timelines' })
  await expect(scopedRow.getByRole('button', { name: 'Open “The Space Race”' })).toBeVisible()
})
