import { test, expect, type Page } from '@playwright/test'

// Per-timeline styled themes: the owner edits a theme in the view-settings
// popover's Theme section → the canvas carries the override vars inline on
// .canvas-root (per active color scheme) + a texture attribute; anonymous
// viewers see the theme but no editor; clearing reverts to the default look.

// Inline custom properties land on .canvas-root's style attribute (React sets
// them via setProperty), so read them from el.style, not getComputedStyle.
const inlineVar = (page: Page, name: string) =>
  page.evaluate(
    (n) => (document.querySelector('.canvas-root') as HTMLElement | null)?.style.getPropertyValue(n) ?? '',
    name,
  )

async function loginAsOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@synek.app')
  await page.getByLabel('Password').fill('demo-password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Figures of science')).toBeVisible()
}

// Pin the app's color scheme via prefers-color-scheme: the demo user's saved
// theme pref is 'system' (ThemeSync would override a cookie pin after sign-in),
// so the resolved scheme follows the emulated media. Playwright defaults to
// light — without this the dark-slot assertions would be vacuous.
test.use({ colorScheme: 'dark' })

test('owner themes a timeline: per-scheme colors, texture, anon sees it, clear reverts', async ({ page }) => {
  await loginAsOwner(page)
  await page.goto('/timelines/figures')
  await expect(page.getByText('Albert Einstein')).toBeVisible()

  // No theme yet → no overrides on the canvas root.
  expect(await inlineVar(page, '--color-accent-primary')).toBe('')
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'default')

  // The Theme section lives in the view-settings popover (owner-gated).
  await page.getByTestId('canvas-settings').click()
  await expect(page.getByTestId('theme-swatches')).toBeVisible()
  await page.getByTestId('theme-edit').click()

  // The editor opens on the active scheme (dark). Set a dark primary, a light
  // primary on the other tab, and the grid texture.
  await expect(page.getByTestId('theme-name')).toBeVisible()
  await page.getByTestId('theme-name').fill('E2E Royal')
  await page.getByTestId('theme-slot-accentPrimary').fill('#aa3366')
  await page.getByTestId('theme-scheme-light').click()
  await page.getByTestId('theme-slot-accentPrimary').fill('#116622')
  await page.getByTestId('theme-texture-grid').click()

  // Edits live-preview before saving.
  expect(await inlineVar(page, '--color-accent-primary')).toBe('#aa3366')
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'grid')

  await page.getByTestId('theme-save').click()
  await expect(page.getByTestId('theme-save')).toHaveCount(0) // dialog closed

  // Saved theme applies (dark scheme → the dark slot), and the alias vars the
  // resolver must re-declare ride along.
  expect(await inlineVar(page, '--color-accent-primary')).toBe('#aa3366')
  expect(await inlineVar(page, '--primary')).toBe('#aa3366')
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'grid')

  // Flip the app to light mode → the light slot takes over.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.getByText('Albert Einstein')).toBeVisible()
  expect(await inlineVar(page, '--color-accent-primary')).toBe('#116622')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByText('Albert Einstein')).toBeVisible()

  // An anonymous viewer sees the theme, but no Theme section in settings.
  const anon = await page.context().browser()!.newContext({ colorScheme: 'dark' })
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:${Number(process.env.E2E_PORT) || 3001}/timelines/figures`)
  await expect(anonPage.getByText('Albert Einstein')).toBeVisible()
  await expect(anonPage.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'grid')
  await anonPage.getByTestId('canvas-settings').click()
  await expect(anonPage.getByText('Show on timeline')).toBeVisible()
  await expect(anonPage.getByTestId('theme-edit')).toHaveCount(0)
  await anon.close()

  // "Ask your agent" copies a set_timeline_theme prompt (the inversion).
  await page.getByTestId('canvas-settings').click()
  await page.getByTestId('theme-prompt').click()
  await expect(page.getByText('set_timeline_theme').first()).toBeVisible()
  await page.keyboard.press('Escape')

  // Clear the theme → the canvas reverts to the default look.
  await page.getByTestId('canvas-settings').click()
  await page.getByTestId('theme-edit').click()
  await page.getByTestId('theme-clear').click()
  await expect(page.getByTestId('theme-save')).toHaveCount(0)
  expect(await inlineVar(page, '--color-accent-primary')).toBe('')
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'default')
})

test('textures render distinctly and the Default option is gone', async ({ page }) => {
  await loginAsOwner(page)
  await page.goto('/timelines/figures')
  await expect(page.getByText('Albert Einstein')).toBeVisible()

  await page.getByTestId('canvas-settings').click()
  await page.getByTestId('theme-edit').click()
  // The "Default" texture button was removed; only none/dots/grid/paper remain.
  await expect(page.getByTestId('theme-texture-default')).toHaveCount(0)
  await expect(page.getByTestId('theme-texture-dots')).toBeVisible()

  const patternColor = () =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector('.canvas-root') as HTMLElement)
        .getPropertyValue('--xy-background-pattern-color')
        .trim(),
    )
  const rfBackgroundImage = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.react-flow') as HTMLElement).backgroundImage)

  // Dots: the explicit texture strengthens the pattern color to the (theme-aware)
  // border-default token — distinctly different from the faint default grid.
  await page.getByTestId('theme-texture-dots').click()
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'dots')
  const dotsColor = await patternColor()
  expect(dotsColor).not.toBe('')

  // Paper: a real SVG grain is painted as the .react-flow background-image.
  await page.getByTestId('theme-texture-paper').click()
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'paper')
  expect(await rfBackgroundImage()).toContain('svg')

  // Click the active texture again to clear it (back to the baseline grid).
  await page.getByTestId('theme-texture-paper').click()
  await expect(page.locator('.canvas-root')).toHaveAttribute('data-canvas-texture', 'default')
})
