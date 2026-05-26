import { test, expect } from '@playwright/test'

// The visual-cards regression anchor: the image-rich `figures` timeline renders
// its entity nodes with portrait <img>s.
test('figures timeline renders image-rich entity nodes', async ({ page }) => {
  await page.goto('/timelines/figures')

  await expect(page.getByText('Albert Einstein')).toBeVisible()
  await expect(page.getByText('Marie Curie')).toBeVisible()

  // Seeded portraits render as <img> on the nodes (asserts the element + src,
  // not pixels — remote images may be blank offline).
  const imgs = page.locator('.sf-img')
  await expect(imgs.first()).toBeAttached()
  await expect(imgs.first()).toHaveAttribute('src', /wikimedia/)
})

test('roman-republic timeline renders BCE-dated nodes', async ({ page }) => {
  await page.goto('/timelines/roman-republic')
  await expect(page.getByText('Julius Caesar')).toBeVisible()
  await expect(page.getByText('Caesar crosses the Rubicon')).toBeVisible()
})
