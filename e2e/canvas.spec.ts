import { test, expect } from '@playwright/test'

// The visual-cards regression anchor: the `figures` timeline renders its person
// entities as portrait "polaroid" cards.
test('figures timeline renders person polaroid cards with portraits', async ({ page }) => {
  await page.goto('/timelines/figures')

  await expect(page.getByText('Albert Einstein')).toBeVisible()
  await expect(page.getByText('Marie Curie')).toBeVisible()

  // Person entities render as .sf-person cards, each with a portrait <img>. The
  // seed renders images directly from their Wikimedia Commons URL (see
  // scripts/seed-images.ts — no local download), so assert that src, not pixels.
  const people = page.locator('.sf-person')
  await expect(people.first()).toBeAttached()
  const portrait = page.locator('.sf-person-portrait')
  await expect(portrait.first()).toBeAttached()
  await expect(portrait.first()).toHaveAttribute('src', /commons\.wikimedia\.org/)
})

test('roman-republic timeline renders BCE-dated nodes', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await expect(page.getByText('Caesar crosses the Rubicon')).toBeVisible()
})

test('period connections are hidden until an endpoint is selected', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()

  const edges = page.locator('.react-flow__edge')
  // 8 edges total; the one touching the "Roman Republic" period is hidden by default.
  await expect(edges).toHaveCount(7)

  // Select nodes by dispatching the click on the node element directly — React Flow
  // can place nodes outside the viewport, so a real .click() (which scrolls) is
  // geometry-dependent and flaky under parallel load. dispatchEvent bubbles to the
  // same node click handler. (Same pattern as node-detail.spec.)
  const node = (text: string) => page.locator('.react-flow__node', { hasText: text })

  // Selecting an endpoint of the period edge (the Rubicon event) reveals it.
  await node('Caesar crosses the Rubicon').dispatchEvent('click')
  await expect(edges).toHaveCount(8)

  // Selecting an unrelated node hides the period edge again.
  await node('Augustus becomes emperor').dispatchEvent('click')
  await expect(edges).toHaveCount(7)
})

test('time-scale compress pulls nodes closer horizontally', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  const a = page.getByText('Julius Caesar').first()
  const b = page.getByText('Caesar crosses the Rubicon').first()
  await expect(a).toBeVisible()
  await expect(b).toBeVisible()
  await page.waitForTimeout(700) // let the initial fitView settle before measuring

  const gap = async () => {
    const [ba, bb] = await Promise.all([a.boundingBox(), b.boundingBox()])
    if (!ba || !bb) throw new Error('node not measurable')
    return Math.abs(ba.x - bb.x)
  }

  const before = await gap()
  // The time-scale controls now live in the display-settings popover — open it first.
  await page.getByTestId('canvas-settings').click()
  const compress = page.getByTestId('time-scale-compress')
  await compress.click()
  await compress.click()
  await page.waitForTimeout(700) // let nodes glide to the new density
  const after = await gap()

  expect(after).toBeLessThan(before * 0.95)
})

// The full horizontal spread of all nodes (screen px), used to prove collapsing
// empty spans pulls the timeline in.
async function nodeSpread(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node'))
    if (!nodes.length) return 0
    const rects = nodes.map((n) => n.getBoundingClientRect())
    return Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))
  })
}

test('collapse gaps compresses empty spans and persists per timeline', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await page.waitForTimeout(700) // initial fitView settles

  const before = await nodeSpread(page)
  // The gap-collapse toggle now lives in the display-settings popover — open it first.
  await page.getByTestId('canvas-settings').click()
  const toggle = page.getByTestId('time-scale-collapse-gaps')
  await toggle.click()
  await page.waitForTimeout(700)
  const after = await nodeSpread(page)

  expect(after).toBeLessThan(before * 0.9)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Persisted per timeline (localStorage): survives a reload.
  await page.reload()
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  // The popover closes on reload — reopen it to read the persisted toggle state.
  await page.getByTestId('canvas-settings').click()
  await expect(page.getByTestId('time-scale-collapse-gaps')).toHaveAttribute('aria-pressed', 'true')
})

// The timeline view carries the same bottom transport + left zoom controls as
// the globe lens, adapted to scroll the canvas: a dated overview with an era
// ribbon and a draggable window marking the on-screen slice; a +/−/fit zoom
// stack at the left-center. roman-republic has a `period` span (era ribbon) and
// BCE dates (axis labels).
test('timeline view shows the bottom scroller and left zoom controls', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await page.waitForTimeout(700) // initial fitView settles

  // The bottom scroller: a year axis, an era ribbon, and the view-window.
  const scrubber = page.locator('.tl-scrubber')
  await expect(scrubber).toBeVisible()
  await expect(page.locator('.tl-window')).toBeAttached()
  expect(await page.locator('.tl-scrubber .globe-axis-label').count()).toBeGreaterThan(0)
  expect(await page.locator('.tl-scrubber .globe-era-seg').count()).toBeGreaterThan(0)

  // The left-center zoom stack (same style as the globe's GS2 control).
  const zoom = page.locator('.tl-zoom')
  await expect(zoom).toBeVisible()
  await expect(zoom.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await expect(zoom.getByRole('button', { name: 'Zoom out' })).toBeVisible()
  await expect(zoom.getByRole('button', { name: 'Fit timeline' })).toBeVisible()

  // Zooming in narrows the view-window (less of the timeline is on screen) — the
  // scroller and the camera zoom are wired to the same viewport.
  const before = (await page.locator('.tl-window').boundingBox())!.width
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await page.waitForTimeout(500)
  const after = (await page.locator('.tl-window').boundingBox())!.width
  expect(after).toBeLessThan(before)
})

// Owner chrome regression: the account menu floats at the FAR RIGHT of the top
// bar, the share control sits just left of it, and the old "Fit view" button is
// gone. The MCP status dot and the undo/redo buttons were removed from the toolbar.
// Requires a session (these controls are owner-gated), so log in as the demo owner first.
test('owner canvas chrome: account far right, share to its left, no mcp dot, no undo/redo, no fit button', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // The cinematic home's "Timelines" carousel heading is the stable signed-in
  // marker (a bare "Figures of science" now matches the hero eyebrow + a card).
  await expect(page.getByRole('heading', { name: 'Timelines' })).toBeVisible()

  await page.goto('/timelines/figures')

  // Wait for the owner toolbar to be present (Share is owner-gated).
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()

  // The MCP status dot was removed from the toolbar.
  await expect(page.getByTestId('mcp-status')).toHaveCount(0)
  // The undo/redo buttons were removed (⌘Z / ⌘⇧Z still work via a headless binding).
  await expect(page.locator('.top-bar').getByRole('button', { name: /Undo/ })).toHaveCount(0)
  await expect(page.locator('.top-bar').getByRole('button', { name: 'Redo' })).toHaveCount(0)

  // The custom top-bar "Fit view" button was removed (React Flow's own zoom
  // controls — bottom-left — keep their fit-view button; scope to the top bar).
  await expect(page.locator('.top-bar').getByRole('button', { name: 'Fit view' })).toHaveCount(0)

  // Share (owner) + account menu live on the right, with account rightmost.
  const share = page.getByRole('button', { name: 'Share' })
  const account = page.getByRole('button', { name: 'Account menu' })
  await expect(share).toBeVisible()
  await expect(account).toBeVisible()
  const shareBox = await share.boundingBox()
  const accountBox = await account.boundingBox()
  expect(accountBox!.x).toBeGreaterThan(shareBox!.x)
})

// The kind filters ("Show on timeline") are merged into the view-settings menu,
// which now also surfaces the current zoom level (timespan on screen) and lets
// −/+ change it. Public view is fine — these controls aren't owner-gated.
test('view settings menu merges kind filters and shows a live zoom level', async ({ page }) => {
  await page.goto('/timelines/figures')
  await expect(page.getByText('Albert Einstein')).toBeVisible()

  await page.getByTestId('canvas-settings').click()

  // Kind filters were merged in under "Show on timeline" — now real checkboxes.
  await expect(page.getByText('Show on timeline')).toBeVisible()
  const peopleToggle = page.getByTestId('filter-kind-person')
  await expect(peopleToggle).toBeChecked()

  // The current zoom level (years across the screen) is shown and changes on +.
  const level = page.getByTestId('time-scale-level')
  await expect(level).toContainText('on screen')
  const before = (await level.textContent()) ?? ''
  await page.getByTestId('time-scale-expand').click()
  await expect(level).not.toHaveText(before)

  // Unchecking a kind drops its nodes from the canvas.
  await peopleToggle.uncheck()
  await expect(peopleToggle).not.toBeChecked()
  await expect(page.getByText('Albert Einstein')).toHaveCount(0)
})
