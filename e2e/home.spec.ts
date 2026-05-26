import { test, expect } from '@playwright/test'

test('home lists seeded timelines and opens one', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Figures of science')).toBeVisible()
  await expect(page.getByText('The Space Race')).toBeVisible()

  await page.getByText('Figures of science').click()
  await expect(page).toHaveURL(/\/timelines\/figures/)
})
