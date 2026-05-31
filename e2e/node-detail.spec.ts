import { test, expect, type Page } from '@playwright/test'

// `figures` is owned by the seeded demo account. Node editing (Upload, Citations,
// Kind) only renders for the owner, so sign in as demo before opening it. (The
// canvas/seed-data specs cover the anonymous read-only public view.)
async function loginAsDemo(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Wait until signed in (the create composer appears) before navigating.
  await expect(page.getByPlaceholder(/Name a timeline/)).toBeVisible()
}

test('clicking a node opens its detail panel', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  // The timeline spans centuries, so edge nodes can sit outside the viewport.
  // Dispatch the click on the node element directly (geometry-independent) —
  // it bubbles to React Flow's node click handler just like a real click.
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')

  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
})

test('detail panel offers manual image upload and citations (no AI illustrate)', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')

  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()

  // Images are user-supplied now — a manual Upload control, no AI generation.
  await expect(panel.getByText('Images', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '+ Upload' })).toBeVisible()

  // Citations remain editable.
  await expect(panel.getByText('Citations', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '+ Add' })).toBeVisible()

  // The removed in-app AI affordances must not reappear.
  await expect(panel.getByRole('button', { name: /illustrate/i })).toHaveCount(0)
})

test('the Kind control reflects and updates an entity subtype', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  // Charles Darwin is seeded as subtype 'person'.
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')

  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel.getByText('Kind', { exact: true })).toBeVisible()

  // Seeded as person → that option is active; switching to org activates it.
  const person = panel.getByRole('button', { name: 'person', exact: true })
  const org = panel.getByRole('button', { name: 'org', exact: true })
  await expect(person).toHaveClass(/detail-size-active/)
  await org.click()
  await expect(org).toHaveClass(/detail-size-active/)
  await expect(person).not.toHaveClass(/detail-size-active/)
})
