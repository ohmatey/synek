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
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Display settings' }).click()
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

test('sparse-time compression is on by default; opting out expands and persists', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await page.waitForTimeout(700) // initial fitView settles

  // Compression is the default — the toggle opens pressed.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Display settings' }).click()
  const toggle = page.getByTestId('time-scale-collapse-gaps')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Toggling OFF returns to the strictly linear axis: the node spread grows.
  const before = await nodeSpread(page)
  await toggle.click()
  await page.waitForTimeout(700)
  const after = await nodeSpread(page)
  expect(after).toBeGreaterThan(before * 1.1)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  // The explicit opt-out persists per timeline (localStorage): survives a reload.
  await page.reload()
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  // The popover closes on reload — reopen it to read the persisted toggle state.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Display settings' }).click()
  await expect(page.getByTestId('time-scale-collapse-gaps')).toHaveAttribute('aria-pressed', 'false')
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

  // Zooming in narrows the view-window (less of the timeline is on screen): the
  // scroller and the camera zoom are wired to the same viewport. The window is
  // clamped at 100% while the WHOLE world is visible (the post-fitView state), and
  // how many 1.2x steps it takes to escape that clamp depends on the world's width,
  // which changes with node sizing. So click until it actually moves rather than
  // guessing a step count (a fixed count has broken twice).
  // Zooming in narrows the view-window (less of the timeline is on screen): the
  // scroller and the camera zoom are wired to the same viewport.
  //
  // This assertion needs a world that is WIDER than the viewport can show, or the
  // window sits clamped at 100% and zooming changes nothing. `roman-republic` is a
  // short span and no longer qualifies (stacked cards are taller, so fitView zooms
  // out further and the whole world fits). Use `stoicism`, which spans ~500 years,
  // so the clamp is escaped regardless of card sizing. Poll, because the transform
  // settles asynchronously and reading straight after a click races under load.
  await page.goto('/timelines/stoicism')
  await expect(page.locator('.tl-scrubber')).toBeVisible()
  await page.waitForTimeout(700) // fitView settles
  const zoomIn = page.locator('.tl-zoom').getByRole('button', { name: 'Zoom in' })
  const before = (await page.locator('.tl-window').boundingBox())!.width
  for (let i = 0; i < 6; i++) await zoomIn.click()
  await expect
    .poll(async () => (await page.locator('.tl-window').boundingBox())!.width, { timeout: 8_000 })
    .toBeLessThan(before)
})

// Owner chrome regression: the account menu floats at the FAR RIGHT of the top
// bar, the ⋯ More overflow (holding Share & export + Display settings) sits just
// left of it, and the old "Fit view" button is gone. The MCP status dot and the
// undo/redo buttons were removed from the toolbar.
// Requires a session (these controls are owner-gated), so log in as the demo owner first.
test('owner canvas chrome: account far right, ⋯ More to its left, no mcp dot, no undo/redo, no fit button', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  // The home's "Projects" grid heading is the stable signed-in list-page marker.
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()

  await page.goto('/timelines/figures')

  // Wait for the toolbar: the ⋯ More overflow is present once the graph loads.
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
  // Share folded into ⋯ More (b65551d) — no top-level Share button on the bar.
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)

  // The MCP status dot was removed from the toolbar.
  await expect(page.getByTestId('mcp-status')).toHaveCount(0)
  // The undo/redo buttons were removed (⌘Z / ⌘⇧Z still work via a headless binding).
  await expect(page.locator('.top-bar').getByRole('button', { name: /Undo/ })).toHaveCount(0)
  await expect(page.locator('.top-bar').getByRole('button', { name: 'Redo' })).toHaveCount(0)

  // The custom top-bar "Fit view" button was removed (React Flow's own zoom
  // controls — bottom-left — keep their fit-view button; scope to the top bar).
  await expect(page.locator('.top-bar').getByRole('button', { name: 'Fit view' })).toHaveCount(0)

  // The ⋯ More overflow + account menu live on the right, account rightmost.
  const more = page.getByRole('button', { name: 'More' })
  const account = page.getByRole('button', { name: 'Account menu' })
  await expect(more).toBeVisible()
  await expect(account).toBeVisible()
  const moreBox = await more.boundingBox()
  const accountBox = await account.boundingBox()
  expect(accountBox!.x).toBeGreaterThan(moreBox!.x)
  // Share & export now lives inside the ⋯ More menu.
  await more.click()
  await expect(page.getByRole('menuitem', { name: /Share/ })).toBeVisible()
})

// The kind filters ("Show on timeline") are merged into the view-settings menu,
// which now also surfaces the current zoom level (timespan on screen) and lets
// −/+ change it. Public view is fine — these controls aren't owner-gated.
test('view settings menu merges kind filters and shows a live zoom level', async ({ page }) => {
  await page.goto('/timelines/figures')
  await expect(page.getByText('Albert Einstein')).toBeVisible()

  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Display settings' }).click()

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
