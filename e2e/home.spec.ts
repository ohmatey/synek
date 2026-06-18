import { test, expect, type Page } from '@playwright/test'

// Timelines are owner-scoped, so the list/create UI requires a session. Sign in
// as the seeded demo account (created by global-setup's seed) via the dedicated
// /login route, which redirects to the workspace on success.
async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Wait until the cinematic home renders (session resolved + landing→dashboard
  // swap). The "Projects" grid heading is the stable signed-in list-page marker
  // (every owner has ≥1 project; the per-type rows were replaced by a projects
  // grid + a "Recently updated" feed).
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('home surfaces the demo timelines in Recently updated and opens one (after login)', async ({ page }) => {
  await loginAsDemo(page)
  // The demo account's timelines now surface in the "Recently updated" feed as
  // unified poster cards (links), most-recent first — alongside its stories. Target
  // by accessible name ("Open timeline …") to avoid the hero eyebrow label clash.
  const recent = page.getByRole('region', { name: 'Recently updated' })
  const figures = recent.getByRole('link', { name: 'Open timeline “Figures of science”' })
  await expect(figures).toBeVisible()

  await figures.click()
  await expect(page).toHaveURL(/\/timelines\/figures/)
})

test('creating a timeline opens it (after login)', async ({ page }) => {
  await loginAsDemo(page)

  // Timelines belong to a project, so creation now lives inside the project view's
  // "Timelines" section (not the list page). Enter the first project, then create:
  // open the "New timeline" dialog, name it, create it, open the fresh canvas.
  await page.getByRole('region', { name: 'Projects' }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\?project=/)
  const timelines = page.getByRole('region', { name: 'Timelines' })
  await timelines.getByRole('button', { name: 'New timeline' }).click()
  // Scope to the open dialog by role only — its accessible name flips from
  // "New timeline" to "… is ready" after the create step, so don't pin the name.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('Renaissance art')
  await dialog.getByRole('button', { name: 'Create timeline' }).click()

  // Creating just makes the empty canvas (content is built later by an MCP
  // client); the dialog flips to a "ready" step — open the canvas from there.
  await dialog.getByRole('button', { name: 'Open the canvas' }).click()
  await expect(page).toHaveURL(/\/timelines\/[^/]+$/)
})

test('after sign-up, the API keys page exposes the endpoint and creates an API key', async ({ page }) => {
  // Logged out, key management is gated, so sign up first (open multi-user
  // registration) via the dedicated /signup route.
  await page.goto('/signup')
  await page.getByLabel('Email').fill(`pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`)
  await page.getByLabel('Password').fill('password1234')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  // A brand-new account has no keys + no content, so the cinematic home shows its
  // new-creator empty state — "Your world starts here" + a "Connect MCP" CTA (the
  // ConnectCta is absorbed into the hero now, key-gated on having no API key).
  await expect(page.getByText('Your world starts here.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Connect MCP' })).toBeVisible()

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
