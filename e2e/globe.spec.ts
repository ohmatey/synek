import { test, expect, type Page } from '@playwright/test'

// Globe lens (docs/product/prd/globe-lens.md). The Timeline | Globe switcher is a
// permanent fixture of the app bar — shown even before any node has coordinates.
// `stoicism` is a fully-coordinated seed (100% located) and carries a cross-globe
// story ("From a shipwreck to the throne"); `blank` is an e2e-only coordinate-free
// fixture used to exercise the switch-to-setup path (all six demo seeds are now
// coordinated). All seeds are public, so these read-only tests run anonymously.

async function switchToGlobe(page: Page) {
  await page.getByRole('radio', { name: 'Globe' }).click()
  const globe = page.getByTestId('globe-lens')
  await expect(globe).toBeVisible()
  return globe
}

test('the view switcher is visible on a seeded timeline', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()

  const switcher = page.getByRole('radiogroup', { name: 'Canvas view' })
  await expect(switcher).toBeVisible()
  // Timeline is the default segment; both segments are radios.
  await expect(switcher.getByRole('radio', { name: 'Timeline' })).toHaveAttribute('aria-checked', 'true')
  await expect(switcher.getByRole('radio', { name: 'Globe' })).toBeVisible()
})

test('clicking Globe on a coordinated timeline switches to the globe and renders markers', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()

  await switchToGlobe(page)

  // SVG markers plot the located nodes.
  await expect(page.locator('.globe-marker-dot').first()).toBeVisible()
  expect(await page.locator('.globe-marker-dot').count()).toBeGreaterThan(0)
  // The Globe segment now reads as selected.
  await expect(page.getByRole('radio', { name: 'Globe' })).toHaveAttribute('aria-checked', 'true')
})

test('pressing Play advances the playback clock (the date label changes)', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()
  await switchToGlobe(page)

  const date = page.locator('.globe-date')
  await expect(date).toBeVisible()
  const initial = (await date.textContent())?.trim() ?? ''

  await page.getByRole('button', { name: 'Play' }).click()
  // The rAF clock walks the cursor forward; the date label tracks it.
  await expect(date).not.toHaveText(initial)
})

test('clicking a marker opens the node detail panel and stays on the globe', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()
  const globe = await switchToGlobe(page)

  // The marker <g> carries the click handler; force past the sphere's overlap.
  await page.locator('.globe-marker').first().click({ force: true })

  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  // Selecting a marker must NOT drop the globe — the lens stays put beside the panel.
  await expect(globe).toBeVisible()
})

test('Escape exits the globe back to the timeline', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()
  await switchToGlobe(page)

  // No panel/dialog open, so Escape is free to exit the lens (PRD §Exit).
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('globe-lens')).toHaveCount(0)
  await expect(page.locator('.react-flow')).toBeVisible()
})

// GS2 — interactive zoom (docs/product/prd/globe-stories.md §GS2). At rest the globe
// sits at 1× (whole sphere), so zoom-out + reset are disabled; the +/− control lifts
// off the floor and back. (Wheel/pinch isn't scriptable here; the control drives the
// same shared ease + clamp.)
test('the globe zoom control clamps at 1× and enables once zoomed in', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()
  await switchToGlobe(page)

  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  const zoomOut = page.getByRole('button', { name: 'Zoom out' })
  const reset = page.getByRole('button', { name: 'Reset zoom' })

  // At the 1× floor: out + reset disabled, in available.
  await expect(zoomIn).toBeEnabled()
  await expect(zoomOut).toBeDisabled()
  await expect(reset).toBeDisabled()

  // Zooming in lifts off the floor — out + reset become available.
  await zoomIn.click()
  await expect(zoomOut).toBeEnabled()
  await expect(reset).toBeEnabled()

  // Reset eases back to the floor and re-disables.
  await reset.click()
  await expect(zoomOut).toBeDisabled()
  await expect(reset).toBeDisabled()
})

// GS1 — globe story mode (docs/product/prd/globe-stories.md). Opening a story while
// the globe is up hands it the transport: each beat eases rotation + zoom to its
// focus node and skips the time cursor to that beat's instant.
// The AppBar Stories popover was replaced by the Stories view (a sibling tab). A
// story opened on the globe (or opened elsewhere then switched onto the globe) still
// hands the reader the transport — so we open Zeno's cross-globe story from his node
// panel on the timeline, then switch to the globe.
async function openZenoStory(page: Page) {
  const zeno = page.locator('.react-flow__node', { hasText: 'Zeno of Citium' })
  await expect(zeno).toBeAttached()
  await zeno.dispatchEvent('click')
  const panel = page.getByRole('dialog', { name: 'Node details' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Play story' }).click()
  await expect(page.getByRole('dialog', { name: /Story:/ })).toBeVisible()
}

test('a story plays on the globe: the reader takes the transport and the beat is framed', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await openZenoStory(page)

  // Switch to the globe — the open reader keeps the transport and the globe enters
  // story mode (GS1), framing the story's moment (Zeno). Its own Play gives way.
  await page.getByRole('radio', { name: 'Globe' }).click()
  const scrubber = page.locator('.globe-scrubber[data-story="true"]')
  await expect(scrubber).toBeVisible()
  await expect(scrubber.getByRole('button', { name: 'Play' })).toHaveCount(0)

  // The beat's focus node (the moment, Zeno) is haloed + labelled on the globe.
  await expect(page.locator('.globe-marker-label')).toContainText('Zeno of Citium')
})

test('a story over the globe respects reduced motion (snaps, renders, no crash)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/timelines/stoicism')
  await openZenoStory(page)

  await page.getByRole('radio', { name: 'Globe' }).click()

  // Under reduced motion the camera snaps instead of easing — the globe still enters
  // story mode and frames the focus without animating.
  await expect(page.locator('.globe-scrubber[data-story="true"]')).toBeVisible()
  await expect(page.getByTestId('globe-lens')).toBeVisible()
  await expect(page.locator('.globe-marker-label')).toContainText('Zeno of Citium')
})

test('clicking Globe with no coordinates shows the empty state, whose primary action creates a globe', async ({
  page,
}) => {
  // `blank` is the e2e-only coordinate-free fixture (0 located nodes).
  await page.goto('/timelines/blank')
  await expect(page.getByRole('radiogroup', { name: 'Canvas view' })).toBeVisible()

  await page.getByRole('radio', { name: 'Globe' }).click()

  // It switches INTO the globe and shows the empty state — no markers to plot.
  await expect(page.getByTestId('globe-lens')).toBeVisible()
  await expect(page.getByTestId('globe-empty')).toBeVisible()
  await expect(page.locator('.globe-marker-dot')).toHaveCount(0)

  // The primary action creates a globe — it opens the setup prompt.
  await page.getByRole('button', { name: 'Create a globe' }).click()
  await expect(page.getByRole('dialog', { name: 'Set up the globe view' })).toBeVisible()
})

// GS3 + GS4 (docs/product/prd/globe-stories.md). The globe floats type+title cards over
// its decluttered markers, and the transport reads as a dated timeline (year labels),
// not a bare slider.
test('the globe shows floating entity cards and a dated axis on the scrubber', async ({ page }) => {
  await page.goto('/timelines/stoicism')
  await expect(page.getByText('Zeno of Citium')).toBeVisible()
  await switchToGlobe(page)

  // Markers plot, and the declutter always surfaces at least the top-priority card.
  expect(await page.locator('.globe-marker-dot').count()).toBeGreaterThan(0)
  expect(await page.locator('.globe-label-title').count()).toBeGreaterThan(0)

  // The scrubber carries year labels — the "timeline showing dates" the founder asked
  // for, in place of a featureless progress bar.
  expect(await page.locator('.globe-axis-label').count()).toBeGreaterThan(0)
})

// GS4 — the era ribbon. roman-republic (fully coordinated) carries a `period` span,
// which renders as a tinted, labeled segment above the scrubber.
test('the globe scrubber shows an era ribbon for period spans', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  // Wait for the graph to load so the coverage gate lets the Globe switch through.
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await switchToGlobe(page)

  expect(await page.locator('.globe-era-seg').count()).toBeGreaterThan(0)
})
