import { test, expect } from '@playwright/test'

// Stories panel (docs/product/prd/stories-view.md). Stories live in their own
// toolbar popover (StoriesMenu) — a list of every story on the timeline + a "New
// Story" action — rather than a full-pane lens that swaps out the canvas. Picking a
// card opens the story in the docked reader over the live canvas. The seeded
// `figures` timeline is public and carries Charles Darwin's 4-beat story ("The long
// wait before Origin"); `blank` is the e2e-only fixture with nodes but no stories.
// All seeds are public, so these read-only tests run anonymously. Reduced motion
// keeps the reader's stepping deterministic (no timed auto-advance).
test.use({ reducedMotion: 'reduce' })

// Open the toolbar Stories popover and click the Darwin story card.
async function openDarwinStory(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Stories/ }).click()
  await page.getByRole('button', { name: /The long wait before Origin/ }).click()
}

test('the view switcher only offers Timeline + Globe; Stories lives in a toolbar panel', async ({ page }) => {
  await page.goto('/timelines/figures')

  const switcher = page.getByRole('radiogroup', { name: 'Canvas view' })
  await expect(switcher.getByRole('radio', { name: 'Timeline' })).toBeVisible()
  await expect(switcher.getByRole('radio', { name: 'Globe' })).toBeVisible()
  // Stories is no longer a lens.
  await expect(switcher.getByRole('radio', { name: 'Stories' })).toHaveCount(0)

  // The Stories toolbar button opens a popover panel listing the timeline's stories,
  // over the live canvas (the timeline isn't swapped out).
  await page.getByRole('button', { name: /^Stories/ }).click()
  await expect(page.getByRole('button', { name: /The long wait before Origin/ })).toBeVisible()
  await expect(page.locator('.react-flow')).toBeVisible()
})

test('clicking a story runs it straight away on the immersive stage (no node selected)', async ({ page }) => {
  await page.goto('/timelines/figures')
  await openDarwinStory(page)

  // It runs straight away (no cover step), WITHOUT selecting a moment — no entity panel
  // opens. The story's first beat is located, so the immersive reader opens on the globe.
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  await expect(reader.getByText('1 / 4')).toBeVisible()
  await expect(page).toHaveURL(/story=/)
  await expect(page).not.toHaveURL(/node=/)
  await expect(page.getByTestId('globe-lens')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Node details' })).toHaveCount(0)

  // Close tears the reader down.
  await reader.getByRole('button', { name: 'Close story' }).click()
  await expect(reader).toBeHidden()
  await expect(page).not.toHaveURL(/story=/)
})

test('a ?story deep-link opens the reader directly (the URL → reader bridge)', async ({ page }) => {
  await page.goto('/timelines/figures')
  await openDarwinStory(page)
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  // The opened story is now in the URL; reloading that link re-opens the reader
  // (home Play / Continue writing rely on this bridge).
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Story: The long wait before Origin' })).toBeVisible()
})

test('a story runs by itself; tapping a related entity opens it beside without ending the story', async ({ page }) => {
  await page.goto('/timelines/figures')
  await openDarwinStory(page)
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  // No entity panel by default — the story plays solo.
  await expect(page.getByRole('dialog', { name: 'Node details' })).toHaveCount(0)

  // Beat 2 references Isaac Newton. Tapping the link opens his panel BESIDE the
  // reader; the story keeps playing (decoupled).
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await reader.getByRole('button', { name: 'Isaac Newton', exact: true }).click()
  await expect(reader).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Node details' }).getByRole('heading', { name: 'Isaac Newton' }),
  ).toBeVisible()
})

test('a timeline with no stories shows the empty state in the panel', async ({ page }) => {
  // `blank` has nodes but no stories.
  await page.goto('/timelines/blank')
  await page.getByRole('button', { name: /^Stories/ }).click()
  await expect(page.getByText(/hasn’t written any stories/)).toBeVisible()
})
