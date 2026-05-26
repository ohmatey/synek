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
