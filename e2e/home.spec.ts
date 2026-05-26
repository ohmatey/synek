import { test, expect } from '@playwright/test'

test('home lists seeded timelines and opens one', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Figures of science')).toBeVisible()
  await expect(page.getByText('The Space Race')).toBeVisible()

  await page.getByText('Figures of science').click()
  await expect(page).toHaveURL(/\/timelines\/figures/)
})

test('creating a timeline opens it', async ({ page }) => {
  await page.goto('/')
  // Scope to the create-timeline composer (the Keys panel also has a labelled input).
  await page.getByPlaceholder(/Name a timeline/).fill('Renaissance art')
  await page.getByRole('button', { name: 'New timeline →' }).click()

  // Content is built later by an MCP client; creating just opens the empty canvas.
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/)
})

test('the Connect panel exposes the MCP endpoint and creates an API key', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect an MCP client' })).toBeVisible()
  await expect(page.locator('.home-connect-code').first()).toHaveText(/\/api\/mcp$/)

  // Create a named key; the raw secret is shown once and listed in the table.
  await page.getByPlaceholder(/Name this key/).fill('Playwright key')
  await page.getByRole('button', { name: 'Create key' }).click()

  await expect(page.locator('.home-connect-token')).toHaveText(/^synek_/)
  await expect(page.locator('.home-keys-table').getByText('Playwright key')).toBeVisible()
})
