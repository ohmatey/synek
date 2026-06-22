import { test, expect, type Page } from '@playwright/test'

// Settings now live in one tabbed dialog opened from the profile menu (the
// /account and /api-keys routes remain as deep-link fallbacks). These cover the
// dialog opening at the right tab and switching between tabs.

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('profile menu opens the settings dialog on the Account tab', async ({ page }) => {
  await loginAsDemo(page)

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Account' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible()
  // Account tab is active and its content (the profile form) is shown.
  await expect(dialog.getByRole('tab', { name: 'Account' })).toHaveAttribute(
    'data-state',
    'active',
  )
  await expect(dialog.getByLabel('Display name')).toBeVisible()
})

test('the API keys menu item opens the dialog on the API keys tab, and tabs switch', async ({
  page,
}) => {
  await loginAsDemo(page)

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'API keys' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'API keys' })).toHaveAttribute(
    'data-state',
    'active',
  )
  // The MCP connect card lives on this tab.
  await expect(dialog.getByText('Connect an MCP client')).toBeVisible()

  // Switching to the Account tab swaps the content in place (no navigation) — the
  // URL stays on the workspace (the root `/`, where login landed), not /account.
  await dialog.getByRole('tab', { name: 'Account' }).click()
  await expect(dialog.getByLabel('Display name')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
