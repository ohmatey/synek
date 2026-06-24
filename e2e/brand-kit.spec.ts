import { test, expect, type Page } from '@playwright/test'

// Brand kits — a first-class, reusable LIBRARY (ADR 0007): the owner authors kits in
// the BrandLibraryDialog (opened from the home "Brand kits" row), each with Identity ·
// Visual · Voice. A kit is then referenced by stories/series (the BrandPicker). This is
// the UI round-trip check; the data-layer contract is verify:brands.
//
// Timestamped names keep tests independent under fullyParallel (the demo account +
// e2e.db are shared).
test.use({ reducedMotion: 'reduce' })

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Create' })).toBeVisible()
}

test('create a brand kit, edit its voice, and it round-trips', async ({ page }) => {
  await loginAsDemo(page)

  // Brand kits live in the account menu now.
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Brand kits' }).click()
  // The dialog's title flips to "Edit brand" inside the editor, so locate it unnamed.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Brand kits' })).toBeVisible()

  // Create → drops into the editor (Identity · Visual · Voice), Name seeded "New brand".
  await dialog.getByRole('button', { name: 'New brand', exact: true }).click()
  const nameField = dialog.getByLabel('Name', { exact: true })
  await expect(nameField).toHaveValue('New brand')
  const name = `E2E Brand ${Date.now()}`
  await nameField.fill(name)

  // Add a personality trait on the Voice tab.
  await dialog.getByRole('tab', { name: 'Voice' }).click()
  await dialog.getByRole('button', { name: 'Add trait' }).click()
  await dialog.getByLabel('Trait 1 name').fill('Confident')

  // Save → back to the list, where the new kit appears by name.
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText(name)).toBeVisible()

  // Re-open via its Edit button: the trait survived (round-trip through brands.kit).
  await dialog.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Edit' }).click()
  await dialog.getByRole('tab', { name: 'Voice' }).click()
  await expect(dialog.getByLabel('Trait 1 name')).toHaveValue('Confident')
})
