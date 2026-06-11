import { test, expect, type Page } from '@playwright/test'

// The seeded `figures` timeline is public, and Charles Darwin carries a 4-beat
// story (see scripts/seed.ts). Viewing a story needs no login (public read), so
// these run anonymously. Reduced-motion is forced so the Reels/Stories viewer
// does NOT auto-advance on a timer — the tap-through stays deterministic and the
// assertions exercise the manual controls (chevrons + tap zones).
test.use({ reducedMotion: 'reduce' })

// Open Charles Darwin's detail panel on the figures canvas. The timeline spans
// centuries, so the node can sit outside the viewport — dispatch the click on the
// element directly (geometry-independent), matching node-detail.spec.
async function openDarwinPanel(page: Page) {
  await page.goto('/timelines/figures')
  const node = page.locator('.react-flow__node', { hasText: 'Charles Darwin' })
  await expect(node).toBeAttached()
  await node.dispatchEvent('click')
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  return panel
}

test('a moment with a story shows a teaser and a Play action', async ({ page }) => {
  const panel = await openDarwinPanel(page)

  await expect(panel.getByText('Story', { exact: true })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'The long wait before Origin' })).toBeVisible()
  // Depth + beat-count chips in the meta row.
  await expect(panel.getByText('Deep', { exact: true })).toBeVisible()
  await expect(panel.getByText('4 beats', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Play story' })).toBeVisible()
})

test('Play opens the Reels-style viewer and tapping through advances the beats', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()

  // The viewer is its own modal dialog, named after the story.
  const viewer = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(viewer).toBeVisible()

  // Beat 1 of 4: the intro title + the opening beat text.
  await expect(viewer.getByRole('heading', { name: 'The long wait before Origin' })).toBeVisible()
  await expect(viewer.getByText(/filled notebook after notebook/)).toBeVisible()
  await expect(viewer.getByText('1 / 4')).toBeVisible()

  // Advance with the explicit Next control → beat 2.
  await viewer.getByRole('button', { name: 'Next beat' }).click()
  await expect(viewer.getByText('2 / 4')).toBeVisible()
  await expect(viewer.getByText(/single principle behind its endless forms/)).toBeVisible()

  // Tapping the right zone advances like Instagram Stories → beat 3.
  await viewer.locator('.sv-zone-next').click()
  await expect(viewer.getByText('3 / 4')).toBeVisible()
  await expect(viewer.getByText(/dreading the reaction/)).toBeVisible()
  // A grounded beat surfaces its source.
  await expect(viewer.getByRole('link', { name: 'Open source ↗' })).toBeVisible()

  // Go back with the Previous control → beat 2 again.
  await viewer.getByRole('button', { name: 'Previous beat' }).click()
  await expect(viewer.getByText('2 / 4')).toBeVisible()

  // Close returns to the canvas; the viewer is gone.
  await viewer.getByRole('button', { name: 'Close story' }).click()
  await expect(viewer).toBeHidden()
})

test('the AppBar Stories list shows preview cards and plays one', async ({ page }) => {
  await page.goto('/timelines/figures')

  // The toolbar surfaces a Stories control (figures has exactly one story).
  const trigger = page.getByRole('button', { name: /Stories/ })
  await expect(trigger).toBeVisible()
  await trigger.click()

  // The popover lists the story as a preview card — title + its moment + beat count.
  const card = page.getByRole('button', { name: /The long wait before Origin/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Charles Darwin')
  await expect(card).toContainText('4 beats')

  // Picking it opens the moment and plays the story in the Reels viewer.
  await card.click()
  const viewer = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText(/filled notebook after notebook/)).toBeVisible()
  await expect(viewer.getByText('1 / 4')).toBeVisible()
})

test('a story beat links to a related moment and navigates there', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const viewer = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(viewer).toBeVisible()

  // Beat 2 references Isaac Newton — stepping to it surfaces the link.
  await viewer.getByRole('button', { name: 'Next beat' }).click()
  const link = viewer.getByRole('button', { name: '→ Isaac Newton' })
  await expect(link).toBeVisible()

  // Tapping it closes the viewer and selects Newton (his panel opens).
  await link.click()
  await expect(viewer).toBeHidden()
  const newtonPanel = page.getByRole('dialog', { name: 'Node details' })
  await expect(newtonPanel.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()
})

// The other tests force reduced-motion (deterministic stepping). This group runs
// with motion ON — the real-browser path — to guard that the viewer OPENS AND
// STAYS open (no auto-advance flash) and that Esc still dismisses it via the
// dialog's native 'cancel' event (the only close-event we bind to the parent, so
// our own programmatic d.close() — incl. React StrictMode's dev double-invoke —
// can't tear the viewer down on open).
test.describe('with motion enabled', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('Play opens the viewer and it stays open; Esc dismisses it', async ({ page }) => {
    const panel = await openDarwinPanel(page)
    await panel.getByRole('button', { name: 'Play story' }).click()

    const viewer = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
    await expect(viewer).toBeVisible()
    // The first beat's timer is long; it must not flash-close.
    await page.waitForTimeout(1200)
    await expect(viewer).toBeVisible()
    await expect(viewer.getByText('1 / 4')).toBeVisible()

    // Esc (native dialog 'cancel') closes it.
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
  })
})
