import { test, expect, type Page } from '@playwright/test'

// The seeded `figures` timeline is public, and Charles Darwin carries a 4-beat
// story (see scripts/seed.ts). Viewing a story needs no login (public read), so
// these run anonymously. Reduced-motion is forced so the docked Reels/Stories
// reader does NOT auto-advance on a timer — the tap-through stays deterministic and
// the assertions exercise the manual controls (chevrons + tap zones).
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

test('Play opens the docked reader beside the panel and tapping through advances the beats', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()

  // The reader is its own dock (role=dialog), named after the story — NOT full-screen.
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  // It sits beside the entity panel, which stays on the canvas.
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()

  // The reader opens on a cover — story title + hook — and Play starts the beats.
  await expect(reader.getByRole('heading', { name: 'The long wait before Origin' })).toBeVisible()
  await expect(reader.getByText('Two decades between the idea and the book.')).toBeVisible()
  await reader.getByRole('button', { name: 'Play story' }).click()

  // Beat 1 of 4: the opening beat text.
  await expect(reader.getByText(/filled notebook after notebook/)).toBeVisible()
  await expect(reader.getByText('1 / 4')).toBeVisible()

  // Advance with the explicit Next control → beat 2.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await expect(reader.getByText(/single principle behind its endless forms/)).toBeVisible()

  // Tapping the right zone advances like Instagram Stories → beat 3.
  await reader.locator('.sv-zone-next').click()
  await expect(reader.getByText('3 / 4')).toBeVisible()
  await expect(reader.getByText(/dreading the reaction/)).toBeVisible()
  // A grounded beat surfaces its source.
  await expect(reader.getByRole('link', { name: 'Open source ↗' })).toBeVisible()

  // Go back with the Previous control → beat 2 again.
  await reader.getByRole('button', { name: 'Previous beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()

  // Close returns to the canvas; the reader is gone (the moment panel stays).
  await reader.getByRole('button', { name: 'Close story' }).click()
  await expect(reader).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()
})

test('selecting a moment does not start the story; Play opens the docked reader, Close tears it down', async ({
  page,
}) => {
  const panel = await openDarwinPanel(page)

  // The standalone top "Story · …" chip + its Pause/Stop transport were removed
  // when the docked reader took over its own transport (TimelineCanvas: "no bar
  // up top"). So selecting a moment must NOT open the reader on its own.
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeHidden()

  // Pressing Play opens the docked reader — which now carries the transport
  // (Play story on the cover, prev/next, Close story).
  await panel.getByRole('button', { name: 'Play story' }).click()
  await expect(reader).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Close story' })).toBeVisible()

  // Close tears the reader down; the moment panel stays on the canvas.
  await reader.getByRole('button', { name: 'Close story' }).click()
  await expect(reader).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()
})

test('the detail panel does NOT auto-follow the beat; the canvas rings the focus (decoupled)', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  // Start the beats from the cover.
  await reader.getByRole('button', { name: 'Play story' }).click()

  const detail = page.getByRole('dialog', { name: 'Node details' })
  // The panel shows the entity the user opened (Darwin) and STAYS there.
  await expect(detail.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()

  // Beat 2 focuses Newton → the canvas rings him, but the panel does NOT switch
  // (stories are decoupled from the entity panel; opening an entity is explicit).
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await expect(page.locator('.react-flow__node.rf-focused', { hasText: 'Isaac Newton' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Isaac Newton' })).toHaveCount(0)
})

test('tapping a beat’s related link opens that entity beside the reader without ending the story', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  // Start the beats from the cover.
  await reader.getByRole('button', { name: 'Play story' }).click()

  // Beat 2 references Isaac Newton — stepping to it surfaces the link.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  const link = reader.getByRole('button', { name: '→ Isaac Newton' })
  await expect(link).toBeVisible()

  // Tapping it opens Newton's panel BESIDE the reader — the story keeps playing
  // (decoupled: an entity is an optional side-trip, not an exit).
  await link.click()
  await expect(reader).toBeVisible()
  const newtonPanel = page.getByRole('dialog', { name: 'Node details' })
  await expect(newtonPanel.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()
})

// The other tests force reduced-motion (deterministic stepping). This group runs
// with motion ON — the real-browser path — to guard that the reader OPENS AND
// STAYS open (no auto-advance flash) and that Esc still dismisses it. The docked
// reader is a plain <aside> (not a native <dialog>), so the StrictMode showModal()
// self-close gotcha can't apply; Esc is handled by the panel's keydown handler.
test.describe('with motion enabled', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('Play opens the reader and it stays open; Esc dismisses it', async ({ page }) => {
    const panel = await openDarwinPanel(page)
    await panel.getByRole('button', { name: 'Play story' }).click()

    const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
    await expect(reader).toBeVisible()
    // Start the beats from the cover. The first beat's timer is long; it must
    // not flash-close.
    await reader.getByRole('button', { name: 'Play story' }).click()
    await page.waitForTimeout(1200)
    await expect(reader).toBeVisible()
    await expect(reader.getByText('1 / 4')).toBeVisible()

    // Esc closes it (handled by the reader's keydown).
    await page.keyboard.press('Escape')
    await expect(reader).toBeHidden()
  })

  test('auto-play can be toggled off so the reader stays put and waits for input', async ({ page }) => {
    const panel = await openDarwinPanel(page)
    await panel.getByRole('button', { name: 'Play story' }).click()
    const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
    await expect(reader).toBeVisible()
    await reader.getByRole('button', { name: 'Play story' }).click()

    // Auto-play is on by default → beat 1's progress segment animates (is-active).
    const seg1 = reader.locator('.sv-seg').nth(0).locator('.sv-seg-fill')
    await expect(seg1).toHaveClass(/is-active/)

    // Turn auto-play off → the segment goes static (is-current) and the timer stops.
    await reader.getByRole('button', { name: 'Turn auto-play off' }).click()
    await expect(seg1).toHaveClass(/is-current/)
    await expect(seg1).not.toHaveClass(/is-active/)
    // It waits for input — still on beat 1 after a beat's worth of time would pass.
    await page.waitForTimeout(1200)
    await expect(reader.getByText('1 / 4')).toBeVisible()

    // Manual stepping still advances while auto-play is off.
    await reader.getByRole('button', { name: 'Next beat' }).click()
    await expect(reader.getByText('2 / 4')).toBeVisible()

    // Toggling auto-play back on resumes the timed slideshow on the current beat.
    await reader.getByRole('button', { name: 'Turn auto-play on' }).click()
    await expect(reader.locator('.sv-seg').nth(1).locator('.sv-seg-fill')).toHaveClass(/is-active/)
  })
})
