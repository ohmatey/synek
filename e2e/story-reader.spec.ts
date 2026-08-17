import { test, expect, type Page } from '@playwright/test'

// The seeded `figures` timeline is public, and Charles Darwin carries a 4-beat
// story (see scripts/seed.ts). Viewing a story needs no login (public read), so
// these run anonymously. Reduced-motion is forced so the docked Reels/Stories
// reader does NOT auto-advance on a timer, keeping the stepping deterministic; the
// assertions exercise the manual controls (chevrons and the keyboard).
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

// Play the Darwin story from the Stories popover, WITHOUT selecting a node first —
// the state in which the companion panel follows the beats instead of being pinned.
async function openDarwinStory(page: Page) {
  await page.getByRole('button', { name: /^Stories/ }).click()
  await page.getByRole('button', { name: /The long wait before Origin/ }).click()
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

test('the auto-play and narration controls reveal hover tooltips', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  // Auto-play is on by default → hovering its control shows the descriptive tooltip.
  await reader.getByTestId('autoplay-toggle').hover()
  await expect(page.getByRole('tooltip', { name: /Auto-play on/ })).toBeVisible()

  // Narration is off by default → its control's tooltip invites reading aloud.
  await reader.getByRole('button', { name: 'Read story aloud' }).hover()
  await expect(page.getByRole('tooltip', { name: 'Read aloud' })).toBeVisible()
})

test('Play opens the docked reader beside the panel and tapping through advances the beats', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()

  // The reader is its own dock (role=dialog), named after the story — NOT full-screen.
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  // It sits beside the entity panel, which stays on the canvas.
  await expect(page.getByRole('dialog', { name: 'Node details' })).toBeVisible()

  // "Play story" runs straight away — no cover step. Beat 1 of 4 is already showing.
  await expect(reader.getByText(/filled notebook after notebook/)).toBeVisible()
  await expect(reader.getByText('1 / 4')).toBeVisible()

  // Advance with the explicit Next control → beat 2.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await expect(reader.getByText(/single principle behind its endless forms/)).toBeVisible()

  // Tapping the card no longer advances: the beat is something to read and to
  // follow links out of, so a stray click must not skip it. Press-and-hold still
  // pauses. Stepping is the chevrons, the arrow keys, or the timer.
  await reader.locator('.sv-zone-next').click()
  await expect(reader.getByText('2 / 4')).toBeVisible()

  // Step on with the real control instead.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('3 / 4')).toBeVisible()
  await expect(reader.getByText(/dreading the reaction/)).toBeVisible()
  // A grounded beat surfaces its source as a citation card. The link is NAMED BY
  // THE SOURCE rather than a repeated "Open source ↗", so a screen-reader link
  // list distinguishes the citations instead of listing N identical entries.
  const cite = reader.locator('.cite-card').first()
  await expect(cite).toBeVisible()
  const citeLink = cite.getByRole('link')
  await expect(citeLink).toHaveAttribute('target', '_blank')
  await expect(citeLink).toHaveAccessibleName(/opens in a new tab/)

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

test('immersive: the story switches globe↔timeline per beat; an explicit selection PINS the panel', async ({
  page,
}) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  const detail = page.getByRole('dialog', { name: 'Node details' })
  // Darwin was opened explicitly BEFORE playback, so he is pinned.
  await expect(detail.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()

  // Beat 1 is a LOCATED beat (lens: globe) → the immersive reader opens on the globe.
  await expect(page.getByTestId('globe-lens')).toBeVisible()

  // Beat 2 is an idea beat (lens: timeline) → the canvas drops to the timeline and
  // rings Newton. The panel FOLLOWS beats by default, but an explicit click pins, and
  // a pin outranks the beat — so Darwin holds. This is the guard on "a click is never
  // stomped by the next beat".
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await expect(page.locator('.react-flow__node.rf-focused', { hasText: 'Isaac Newton' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Charles Darwin' })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Isaac Newton' })).toHaveCount(0)
})

test('with nothing pinned, the companion panel follows the beat and holds on a beat that names no one', async ({
  page,
}) => {
  await page.goto('/timelines/figures')
  await openDarwinStory(page)
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  const detail = page.getByRole('dialog', { name: 'Node details' })

  // Beat 1's focus IS the story's own moment (Darwin), which is filtered out as a
  // follow target — the story is already about him — so no companion opens yet.
  await expect(reader.getByText('1 / 4')).toBeVisible()
  await expect(detail).toHaveCount(0)

  // Beat 2 names Newton → the companion opens on him with no click at all.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('2 / 4')).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()

  // Beat 3's focus is the moment again (no new entity). The panel must HOLD Newton
  // rather than blink shut — the sticky-follow guard.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  await expect(reader.getByText('3 / 4')).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()
})

test('the reader holds the flush-right dock slot and the companion panel sits to its LEFT', async ({ page }) => {
  await page.goto('/timelines/figures')
  await openDarwinStory(page)
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  // Step to a beat that opens the companion, so both docks are mounted.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  const detail = page.getByRole('dialog', { name: 'Node details' })
  await expect(detail.getByRole('heading', { name: 'Isaac Newton' })).toBeVisible()

  // Geometry is the contract here: a story in progress must never be displaced by an
  // entity opening beside it, so the reader stays rightmost and the panel goes left.
  const readerBox = (await reader.boundingBox())!
  const detailBox = (await detail.boundingBox())!
  expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(readerBox.x + 1)

  const viewport = page.viewportSize()!
  // The reader is flush against the right gutter (16px), not floating mid-canvas.
  expect(viewport.width - (readerBox.x + readerBox.width)).toBeLessThanOrEqual(24)
})

test('tapping a beat’s related link opens that entity beside the reader without ending the story', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()

  // Beat 2 references Isaac Newton — stepping to it surfaces the link.
  await reader.getByRole('button', { name: 'Next beat' }).click()
  // The beat's related links are named by the entity alone now (the decorative
  // '→' prefix is gone), and focusNodeId is included alongside relatedNodeIds.
  const link = reader.getByRole('button', { name: 'Isaac Newton', exact: true })
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
    // It runs straight away (no cover). The first beat's timer is long; it must
    // not flash-close.
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

// The docked reader can overwhelm the screen (esp. mobile), so it can be MINIMIZED to
// a compact bar and expanded again. Minimizing keeps the reader mounted — the progress
// strip stays so playback continues behind the bar — and only hides the beat body.
test('the story reader can be minimized to a bar and expanded again', async ({ page }) => {
  const panel = await openDarwinPanel(page)
  await panel.getByRole('button', { name: 'Play story' }).click()
  const reader = page.getByRole('dialog', { name: 'Story: The long wait before Origin' })
  await expect(reader).toBeVisible()
  // Expanded: the beat stage is showing.
  await expect(reader.locator('.sv-stage')).toBeVisible()

  // Minimize → collapse to the bar: the beat stage is hidden, but the reader and its
  // progress strip stay mounted (playback keeps running).
  await reader.getByRole('button', { name: 'Minimize story' }).click()
  await expect(reader).toHaveAttribute('data-minimized', 'true')
  await expect(reader.locator('.sv-stage')).toBeHidden()
  await expect(reader.locator('.sv-progress')).toBeAttached()

  // Expand → the full panel returns.
  await reader.getByRole('button', { name: 'Expand story' }).click()
  await expect(reader).not.toHaveAttribute('data-minimized', 'true')
  await expect(reader.locator('.sv-stage')).toBeVisible()
})
