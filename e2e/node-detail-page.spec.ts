import { test, expect, type Page } from '@playwright/test'

// The dedicated full-screen entity page (/timelines/$id/nodes/$nodeId) — the same
// NodeDetailPanel as the docked side panel, decoupled from the canvas. `figures`
// is a seeded, PUBLIC timeline owned by demo, so the read-only view is reachable
// signed-out; editing only renders for the owner.

async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
}

// Node ids are random UUIDs (seed), so capture Darwin's id from the canvas: click
// the node, which writes ?node=<id> into the URL. Works signed-out too (figures is
// public). Returns the node id.
async function darwinIdFromCanvas(page: Page): Promise<string> {
  await page.goto('/timelines/figures')
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()
  await expect.poll(() => new URL(page.url()).searchParams.get('node')).toBeTruthy()
  return new URL(page.url()).searchParams.get('node')!
}

test('the docked panel expands to the full-screen entity page', async ({ page }) => {
  await loginAsDemo(page)
  const id = await darwinIdFromCanvas(page)

  // The "open full page" affordance lives in the docked panel header.
  await page.getByTestId('open-node-page').click()

  await expect(page).toHaveURL(new RegExp(`/timelines/figures/nodes/${id}$`))
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()
  // The page is the standalone layout, not the docked dock.
  await expect(panel).toHaveClass(/node-page/)
})

test('deep-linking the page loads the entity, and an edit round-trips', async ({ page }) => {
  await loginAsDemo(page)
  const id = await darwinIdFromCanvas(page)

  await page.goto(`/timelines/figures/nodes/${id}`)
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()

  // Edit → change the title → Save → reload → persisted.
  await panel.getByTestId('edit-node').click()
  const titleInput = panel.getByLabel('Title')
  await titleInput.fill('Charles Darwin (edited)')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByTestId('edit-node')).toBeVisible() // back to read mode
  await page.reload()
  await expect(panel.getByRole('heading', { name: 'Charles Darwin (edited)' })).toBeVisible()

  // Restore the seeded title so the shared e2e DB stays clean for sibling specs.
  await panel.getByTestId('edit-node').click()
  await panel.getByLabel('Title').fill('Charles Darwin')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()
})

test('the back link returns to the canvas with the node selected', async ({ page }) => {
  await loginAsDemo(page)
  const id = await darwinIdFromCanvas(page)

  await page.goto(`/timelines/figures/nodes/${id}`)
  await page.getByTestId('node-page-back').click()

  await expect(page).toHaveURL(new RegExp(`/timelines/figures\\?node=${id}`))
  // The canvas reopens the docked panel for the selected node.
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()
})

test('a public timeline node is viewable read-only when signed out', async ({ page }) => {
  // No login — figures is public.
  const id = await darwinIdFromCanvas(page)

  await page.goto(`/timelines/figures/nodes/${id}`)
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()
  // Read-only: no edit affordance for a non-owner.
  await expect(panel.getByTestId('edit-node')).toHaveCount(0)
})

test('an unknown node id renders the not-available page', async ({ page }) => {
  await page.goto('/timelines/figures/nodes/this-node-does-not-exist')
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Node details' })).toHaveCount(0)
})
