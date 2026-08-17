import { test, expect, type Page } from '@playwright/test'

// `figures` is owned by the seeded demo account. Node editing (Upload, Citations,
// Kind) only renders for the owner, so sign in as demo before opening it. (The
// canvas/seed-data specs cover the anonymous read-only public view.)
async function loginAsDemo(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // Wait until signed in before navigating. The workspace list page (328e633)
  // leads with a "Projects" grid — that heading is the stable signed-in marker.
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
}

async function openDarwinPanel(page: Page) {
  // The timeline spans centuries, so edge nodes can sit outside the viewport.
  // Dispatch the click on the node element directly (geometry-independent) —
  // it bubbles to React Flow's node click handler just like a real click.
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')

  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  return panel
}

test('relations state direction as a phrase, not a bare arrow', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')
  const panel = await openDarwinPanel(page)

  // The seeded edge is `Isaac Newton --influenced--> Charles Darwin`, so from
  // Darwin's panel this is an INCOMING influence and must read "influenced by".
  // The old UI rendered a bare ← next to the raw kind, which could equally have
  // meant Darwin influenced Newton. Asserting the phrase is asserting the fix.
  const relation = panel.getByRole('button', { name: /Charles Darwin influenced by Isaac Newton/i })
  await expect(relation).toBeVisible()
  await expect(relation).toContainText('influenced by')

  // And it still navigates to the other endpoint.
  await relation.click()
  await expect(panel.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()

  // From Newton's side the SAME edge is outgoing, so it reads the other way.
  await expect(panel.getByRole('button', { name: /Isaac Newton influenced Charles Darwin/i })).toBeVisible()
})

test('citations render as uniform cards with one link, and can be collapsed', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/stoicism')

  // Disambiguate from the EVENT "Chrysippus systematizes the Stoa" — match the
  // person node by its summary, which only the entity carries.
  const node = page.locator('.react-flow__node', { hasText: 'Third head of the Stoa' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()

  const toggle = panel.getByRole('button', { name: /Citations/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // ONE anchor per card. The old panel emitted two links to the same href (the
  // title, then the shortened URL again underneath).
  const card = panel.locator('.cite-card').first()
  await expect(card).toBeVisible()
  await expect(card.locator('a')).toHaveCount(1)
  const link = card.locator('a')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noreferrer noopener')

  // Collapsing hides the stack, which on a well-sourced node is the longest
  // thing in the panel.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.locator('.cite-card')).toHaveCount(0)
})

test('clicking a node opens its detail panel', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  const panel = await openDarwinPanel(page)
  await expect(panel.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
})

test('the panel opens in read mode; Edit reveals upload and citations (no AI illustrate)', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  const panel = await openDarwinPanel(page)

  // 100% read mode on open: no editors, no presentation knobs.
  await expect(panel.getByRole('button', { name: 'Upload' })).toHaveCount(0)
  await expect(panel.getByText('Size', { exact: true })).toBeHidden()
  await expect(panel.getByText('Lane', { exact: true })).toBeHidden()

  // The explicit Edit button flips the whole panel into edit mode: image
  // management (manual Upload, no AI generation) and the citations editor mount.
  await panel.getByTestId('edit-node').click()
  await expect(panel.getByRole('button', { name: 'Upload' })).toBeVisible()
  await expect(panel.getByText('Citations', { exact: true })).toBeVisible()
  await expect(panel.getByTestId('add-citation')).toBeVisible()

  // The removed in-app AI affordances must not reappear.
  await expect(panel.getByRole('button', { name: /illustrate/i })).toHaveCount(0)

  // Cancel returns to read mode.
  await panel.getByRole('button', { name: 'Cancel' }).click()
  await expect(panel.getByRole('button', { name: 'Upload' })).toHaveCount(0)
})

test('the Kind control reflects and updates an entity subtype', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/timelines/figures')

  const panel = await openDarwinPanel(page)

  // Charles Darwin is seeded as subtype 'person' — read mode folds it into the
  // meta line under the title instead of a property row.
  await expect(panel.locator('.detail-dateline')).toContainText(/person/i)

  // Edit mode mounts the subtype picker directly (no click-to-reveal).
  await panel.getByTestId('edit-node').click()
  await expect(panel.getByText('Kind', { exact: true })).toBeVisible()

  // Seeded as person → that option is active; switching to org activates it.
  const person = panel.getByRole('button', { name: 'person', exact: true })
  const org = panel.getByRole('button', { name: 'org', exact: true })
  await expect(person).toHaveAttribute('aria-pressed', 'true')
  await org.click()
  await expect(org).toHaveAttribute('aria-pressed', 'true')
  await expect(person).toHaveAttribute('aria-pressed', 'false')
})
