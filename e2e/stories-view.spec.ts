import { test, expect } from '@playwright/test'

// Stories view (docs/product/prd/stories-view.md). A third tab beside Timeline +
// Globe that lists every story on the timeline and plays it by itself. The seeded
// `figures` timeline is public and carries Charles Darwin's 4-beat story ("The long
// wait before Origin"); `blank` is the e2e-only fixture with nodes but no stories.
// All seeds are public, so these read-only tests run anonymously. Reduced motion
// keeps the reader's stepping deterministic (no timed auto-advance).
test.use({ reducedMotion: 'reduce' })

test('the view switcher offers a third Stories tab that opens the story list', async ({ page }) => {
  await page.goto('/timelines/figures')

  const switcher = page.getByRole('radiogroup', { name: 'Canvas view' })
  await expect(switcher.getByRole('radio', { name: 'Timeline' })).toBeVisible()
  await expect(switcher.getByRole('radio', { name: 'Globe' })).toBeVisible()
  await expect(switcher.getByRole('radio', { name: 'Stories' })).toBeVisible()

  await switcher.getByRole('radio', { name: 'Stories' }).click()
  await expect(page).toHaveURL(/view=stories/)
  await expect(switcher.getByRole('radio', { name: 'Stories' })).toHaveAttribute('aria-checked', 'true')

  // The list renders the timeline's stories (the canvas / globe are gone).
  const list = page.getByRole('region', { name: 'Stories' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('button', { name: /The long wait before Origin/ })).toBeVisible()
  await expect(page.locator('.react-flow')).toHaveCount(0)
})

test('deep-linking ?view=stories lands directly on the list', async ({ page }) => {
  await page.goto('/timelines/figures?view=stories')
  const list = page.getByRole('region', { name: 'Stories' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('button', { name: /The long wait before Origin/ })).toBeVisible()
})

test('clicking a story docks its cover (no node selected); Play raises the timeline; Close returns to the list', async ({
  page,
}) => {
  await page.goto('/timelines/figures?view=stories')
  await page.getByRole('button', { name: /The long wait before Origin/ }).click()

  // The cover docks on the right WITHOUT selecting a moment — no entity panel opens,
  // and the list stays in the main area behind it.
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  await expect(page).toHaveURL(/story=/)
  await expect(page).not.toHaveURL(/node=/)
  await expect(page.getByRole('region', { name: 'Stories' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Node details' })).toHaveCount(0)

  // Play raises the timeline as the story's stage; the list gives way to the canvas.
  await reader.getByRole('button', { name: 'Play story' }).click()
  await expect(reader.getByText('1 / 4')).toBeVisible()
  await expect(page.locator('.react-flow')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Stories' })).toHaveCount(0)
  await expect(page).not.toHaveURL(/view=stories/)

  // Close returns to the Stories list (where the story was opened from).
  await reader.getByRole('button', { name: 'Close story' }).click()
  await expect(reader).toBeHidden()
  await expect(page).toHaveURL(/view=stories/)
  await expect(page.getByRole('region', { name: 'Stories' })).toBeVisible()
})

test('a story from the list runs by itself; tapping a related entity opens it beside without ending the story', async ({
  page,
}) => {
  await page.goto('/timelines/figures?view=stories')
  await page.getByRole('button', { name: /The long wait before Origin/ }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await reader.getByRole('button', { name: 'Play story' }).click()

  // No entity panel by default — the story plays solo.
  await expect(page.getByRole('dialog', { name: 'Node details' })).toHaveCount(0)

  // Beat 2 references Isaac Newton. Tapping the link opens his panel BESIDE the
  // reader; the story keeps playing (decoupled).
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await reader.getByRole('button', { name: '→ Isaac Newton' }).click()
  await expect(reader).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Node details' }).getByRole('heading', { name: 'Isaac Newton' }),
  ).toBeVisible()
})

test('a timeline with no stories shows the empty state', async ({ page }) => {
  // `blank` has nodes but no stories.
  await page.goto('/timelines/blank?view=stories')
  const list = page.getByRole('region', { name: 'Stories' })
  await expect(list).toBeVisible()
  await expect(list.getByText('No stories yet')).toBeVisible()
})
