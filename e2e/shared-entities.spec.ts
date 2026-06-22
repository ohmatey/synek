import { test, expect, type Page } from '@playwright/test'

// ADR 0004 — placing a shared entity onto a second timeline, the "also appears on"
// aggregation, and the per-entity content undo on the full-screen entity page.
// Placement targets `stoicism` (NOT guarded by seed-data's exact node counts);
// content edits keep the original title as a substring so a parallel figures
// seed-data check still matches, then undo restores it.

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

test('place a shared entity on another timeline → it reports "also appears on"', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/stoicism')

  await page.getByTestId('add-entity').click()
  const search = page.getByLabel('Search your entities')
  await expect(search).toBeVisible()
  await search.fill('Charles Darwin')
  const row = page.getByRole('button', { name: /Charles Darwin/ })
  await expect(row).toBeVisible()
  await row.click()

  // The placement renders on the stoicism canvas.
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()

  // Its full-screen page reports the OTHER timeline it appears on.
  await node.dispatchEvent('click')
  await page.getByTestId('open-node-page').click()
  const appears = page.getByTestId('appears-on')
  await expect(appears).toBeVisible()
  await expect(appears.getByRole('link', { name: 'Figures of science' })).toBeVisible()
})

test('editing shared content propagates; the entity undo reverts it', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')
  // Use Ada Lovelace (not placed elsewhere) to avoid contending with the Darwin test.
  const node = page.locator('.react-flow__node', { hasText: 'Ada Lovelace' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')
  await page.getByTestId('open-node-page').click()
  const panel = page.getByRole('dialog', { name: 'Node details' })

  await panel.getByTestId('edit-node').click()
  await panel.getByLabel('Title').fill('Ada Lovelace (e2e)')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('heading', { name: 'Ada Lovelace (e2e)' })).toBeVisible()

  // Per-entity content undo (separate from the canvas ⌘Z) reverts it.
  await page.getByTestId('entity-undo').click()
  await expect(panel.getByRole('heading', { name: 'Ada Lovelace', exact: true })).toBeVisible()
})
