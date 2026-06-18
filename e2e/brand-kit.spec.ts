import { test, expect, type Page } from '@playwright/test'

// Project branding (theme + brand voice built into a project). The former per-account
// brand-kit LIBRARY (author many kits, link one to a project) was folded into the
// project itself: each project owns a single theme + brand kit, edited from the
// project hero's "Customize" button (ProjectBrandingDialog). This is the UI-level
// integration check; the data-layer contract is verify:brands (the dormant table).
//
// Mirrors cinematic-home.spec: sign in as the seeded demo account, create a fresh
// project (timestamped to stay independent under fullyParallel — the demo account +
// e2e.db are shared), open its branding editor, edit a field + save, then re-open
// and assert the edit round-tripped.
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await expect(dialog).toBeHidden()
}

test('edit a project’s built-in brand voice and it round-trips', async ({ page }) => {
  await loginAsDemo(page)

  // A fresh project — creating one enters its page (?project=<slug>), which shows the
  // project hero carrying the "Customize" branding affordance.
  const projectName = `Brand Project ${Date.now()}`
  await createProject(page, projectName)
  await expect(page.getByRole('region', { name: `Project: ${projectName}` })).toBeVisible()

  // Open the project branding editor from the hero. It has two tabs now: Theme and
  // Voice (the Identity/Visual brand sections were dropped).
  await page.getByRole('button', { name: 'Customize' }).click()
  const dialog = page.getByRole('dialog', { name: 'Project branding' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Identity' })).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Visual' })).toHaveCount(0)

  // Edit a brand-voice field: add a personality trait on the Voice tab.
  await dialog.getByRole('tab', { name: 'Voice' }).click()
  await dialog.getByRole('button', { name: 'Add trait' }).click()
  await dialog.getByLabel('Trait 1 name').fill('Confident')

  // Save — the schema-valid edit persists and the dialog closes.
  await dialog.getByTestId('project-branding-save').click()
  await expect(dialog).toBeHidden()

  // Re-open: the trait survived the save (round-trip through projects.brand).
  await page.getByRole('button', { name: 'Customize' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Voice' }).click()
  await expect(dialog.getByLabel('Trait 1 name')).toHaveValue('Confident')
})
