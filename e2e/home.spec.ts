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
  await page.locator('.composer-input').fill('Renaissance art')
  await page.getByRole('button', { name: 'New timeline →' }).click()

  // Content is built later by an MCP client; creating just opens the empty canvas.
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/)
})

test('the Connect panel exposes the MCP endpoint and reveals a token', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect an MCP client' })).toBeVisible()
  await expect(page.locator('.home-connect-code').first()).toHaveText(/\/api\/mcp$/)

  // The token is masked until revealed; revealing mints the local session token.
  await page.getByRole('button', { name: 'Reveal token' }).click()
  await expect(page.locator('.home-connect-token')).not.toBeEmpty()
})
