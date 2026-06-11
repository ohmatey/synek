import { test, expect, type Page } from '@playwright/test'

// Timelines are owner-scoped, so the list/create UI requires a session. Sign in
// as the seeded demo account (created by global-setup's seed) via the dedicated
// /login route, which redirects to the workspace on success.
async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
}

test('home lists the demo timelines and opens one (after login)', async ({ page }) => {
  await loginAsDemo(page)
  // The demo account owns the seeded timelines, so they appear once signed in.
  await expect(page.getByText('Figures of science')).toBeVisible()
  await expect(page.getByText('The Space Race')).toBeVisible()

  await page.getByText('Figures of science').click()
  await expect(page).toHaveURL(/\/timelines\/figures/)
})

test('creating a timeline opens it (after login)', async ({ page }) => {
  await loginAsDemo(page)
  // The create composer only renders when signed in.
  await page.getByPlaceholder(/Name a timeline/).fill('Renaissance art')
  await page.getByRole('button', { name: 'New timeline' }).click()

  // Content is built later by an MCP client; creating just opens the empty canvas.
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/)
})

test('after sign-up, the API keys page exposes the endpoint and creates an API key', async ({ page }) => {
  // Logged out, key management is gated, so sign up first (open multi-user
  // registration) via the dedicated /signup route.
  await page.goto('/signup')
  await page.getByLabel('Email').fill(`pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`)
  await page.getByLabel('Password').fill('password1234')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  // A brand-new account has no keys yet, so the workspace home nudges toward the
  // API keys page (the keys + connect instructions now live there, not on home).
  await expect(page.getByText('Create an API key to connect your MCP client')).toBeVisible()

  // Open the API keys page; it shows the MCP endpoint. (The "Connect an MCP
  // client" title is a shadcn CardTitle <div>, not a heading role.)
  await page.goto('/api-keys')
  await expect(page.getByText('Connect an MCP client')).toBeVisible()
  await expect(page.getByTestId('mcp-endpoint')).toHaveText(/\/api\/mcp$/)

  // Create a named key; the raw secret is shown once and listed.
  await page.getByPlaceholder(/Name this key/).fill('Playwright key')
  await page.getByRole('button', { name: 'Create key' }).click()

  await expect(page.getByTestId('fresh-key')).toHaveText(/^synek_/)
  await expect(page.getByTestId('keys-table').getByText('Playwright key')).toBeVisible()
})

test('theme is set from the profile menu and persists per user', async ({ page }) => {
  // Fresh account so the theme starts unset (resolves to system).
  await page.goto('/signup')
  await page.getByLabel('Email').fill(`pw-theme-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`)
  await page.getByLabel('Password').fill('password1234')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  // Choose Light via the profile menu's Theme submenu (the only theme switcher now).
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Theme' }).click()
  await page.getByRole('menuitem', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Force a stale/other-device cookie to dark, then reload: the per-user value
  // (saved on the account, applied by ThemeSync) must win over the cookie.
  await page.evaluate(() => {
    document.cookie = 'synek-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax'
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
