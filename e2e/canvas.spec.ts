import { test, expect } from '@playwright/test'

// The visual-cards regression anchor: the `figures` timeline renders its person
// entities as portrait "polaroid" cards.
test('figures timeline renders person polaroid cards with portraits', async ({ page }) => {
  await page.goto('/timelines/figures')

  await expect(page.getByText('Albert Einstein')).toBeVisible()
  await expect(page.getByText('Marie Curie')).toBeVisible()

  // Person entities render as .sf-person cards, each with a portrait <img>
  // (asserts the element + local /seed/ src — not pixels).
  const people = page.locator('.sf-person')
  await expect(people.first()).toBeAttached()
  const portrait = page.locator('.sf-person-portrait')
  await expect(portrait.first()).toBeAttached()
  await expect(portrait.first()).toHaveAttribute('src', /\/seed\//)
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
  // 4 edges total; the one touching the "Roman Republic" period is hidden.
  await expect(edges).toHaveCount(3)

  // Selecting an endpoint of the period edge (the Rubicon event) reveals it.
  await page.getByText('Caesar crosses the Rubicon').click()
  await expect(edges).toHaveCount(4)

  // Selecting an unrelated node hides the period edge again.
  await page.getByText('Augustus becomes emperor').click()
  await expect(edges).toHaveCount(3)
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
  const toggle = page.getByTestId('time-scale-collapse-gaps')
  await toggle.click()
  await page.waitForTimeout(700)
  const after = await nodeSpread(page)

  expect(after).toBeLessThan(before * 0.9)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Persisted per timeline (localStorage): survives a reload.
  await page.reload()
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await expect(page.getByTestId('time-scale-collapse-gaps')).toHaveAttribute('aria-pressed', 'true')
})
