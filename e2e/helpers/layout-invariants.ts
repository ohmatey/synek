import { expect, type Page } from '@playwright/test'

// Shared layout/scroll invariants — the zero-dependency complement to functional
// e2e (sector137 foundry's visual-testing capability, Technique 1). Functional
// e2e asserts presence and roles; it is structurally blind to layout, scroll
// position, and element-count bugs. These three assertions catch the exact class
// of regressions a full green suite once shipped anyway:
//   1. off-screen hero (a tall page vertically centered above the fold),
//   2. auto-scroll on mount (a reader's element.focus() scrolling past the hero),
//   3. a double <h1> (a shared component heading + a page heading on one page).
//
// Reach for this in every page-level spec, right after navigating the key route.
export async function assertTopAligned(page: Page, headingSelector = 'h1') {
  // The hero must be in the viewport, not centered off-screen.
  await expect(page.locator(headingSelector).first()).toBeInViewport()

  // The page must load at the top — let any post-mount scroll effect settle
  // first (a focus()-on-mount reader is exactly what this guards against), then
  // assert nothing scrolled past the hero.
  await page.waitForLoadState('networkidle')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // Exactly one <h1> on the page — catches the double-heading bug.
  await expect(page.locator(headingSelector)).toHaveCount(1)
}
