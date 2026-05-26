import { test, expect } from '@playwright/test'
import { mockChatSuccess, mockChatError } from './fixtures/mock-chat'

test('mocked chat turn renders the assistant reply', async ({ page }) => {
  await mockChatSuccess(page, 'Done — added to the timeline.')
  await page.goto('/timelines/figures')

  const input = page.locator('.composer-input')
  await expect(input).toBeVisible()
  await input.fill('Add a node for Galileo')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText('Done — added to the timeline.')).toBeVisible()
})

test('a failed turn surfaces the error banner with Retry/Dismiss', async ({ page }) => {
  await mockChatError(page, 'Set OPENROUTER_API_KEY to chat.')
  await page.goto('/timelines/figures')

  const input = page.locator('.composer-input')
  await expect(input).toBeVisible()
  await input.fill('Add a node for Galileo')
  await page.getByRole('button', { name: 'Send' }).click()

  const banner = page.getByRole('alert')
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible()
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toBeHidden()
})
