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
