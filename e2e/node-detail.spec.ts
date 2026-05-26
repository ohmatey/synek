import { test, expect } from '@playwright/test'

test('clicking a node opens its detail panel', async ({ page }) => {
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
