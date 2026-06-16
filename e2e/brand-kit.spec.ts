import { test, expect, type Page } from '@playwright/test'

// Brand-kit editor (stories-first pivot, slice 2). The project rail carries a
// "Brand kits" affordance that opens a manager modal over the cinematic home: list
// + create a local brand, drill into the section editor, edit a field + save, and
// — when a project is the active filter — link the brand to that project. This is
// the UI-level integration check; the data-layer contract is verify:brands.
//
// Mirrors cinematic-home.spec / home.spec: sign in as the seeded demo account,
// create a fresh project so the rail has an active project to link to (timestamped
// to stay independent under fullyParallel — the demo account + e2e.db are shared).
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
}

test('create a brand, edit a section, link it to a project', async ({ page }) => {
  await loginAsDemo(page)

  // Active project to link the brand to (the rail passes it to the editor as the
  // link target). The rail selects it on create (?project=<slug>).
  const projectName = `Brand Project ${Date.now()}`
  await createProject(page, projectName)

  // Open the brand manager from the rail.
  await page.getByRole('button', { name: 'Brand kits' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Brand kits' })).toBeVisible()

  // Create a brand — the manager drills straight into its editor.
  const brandName = `Northwind ${Date.now()}`
  await dialog.getByLabel('New brand').fill(brandName)
  await dialog.getByRole('button', { name: 'Create' }).click()

  // The editor opened on the Identity tab: edit the tagline (a section field).
  await expect(dialog.getByLabel('Brand name')).toHaveValue(brandName)
  await dialog.getByRole('tab', { name: 'Identity' }).click()
  await dialog.getByLabel('Tagline').fill('Roasted small, shipped fresh')

  // Link the brand to the active project (the link control is shown because the
  // manager was opened with a project context).
  await expect(dialog.getByText(`Project: ${projectName}`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Link to project' }).click()
  // After linking, the control flips to "Unlink".
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()

  // Save the kit — the schema-valid edit persists and the saved marker appears.
  await dialog.getByRole('button', { name: 'Save brand' }).click()
  await expect(dialog.getByText('Saved')).toBeVisible()

  // Re-open the editor: the tagline survived the save (round-trip through the kit).
  // The brand's list row carries the new tagline as its subtitle — assert it shows
  // (the round-trip is visible in the list itself), then re-open via the row's open
  // button (scoped to the listitem so the row's Delete button doesn't clash).
  await dialog.getByRole('button', { name: 'Back to brands' }).click()
  const row = dialog.getByRole('listitem').filter({ hasText: brandName })
  await expect(row.getByText('Roasted small, shipped fresh')).toBeVisible()
  await row.getByRole('button', { name: `${brandName} Roasted small, shipped fresh` }).click()
  await dialog.getByRole('tab', { name: 'Identity' }).click()
  await expect(dialog.getByLabel('Tagline')).toHaveValue('Roasted small, shipped fresh')
})
