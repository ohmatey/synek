import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Shared accessibility invariant — the second half of the sector137 foundry's
// visual-testing capability (Technique 2). Functional e2e asserts that a role or
// label is present; it is blind to structural a11y violations like a double <h1>
// (heading-order), a missing landmark, an unlabeled control, or an alt-less image.
// One AxeBuilder pass guards all of those at once.
//
// `color-contrast` is ON by default. Themed reader surfaces derive their small
// accent text and on-accent fills from the readable --color-accent-*-text /
// --color-on-* tokens (curated in tokens.css, re-derived per overridden accent in
// resolveThemeVars), so the gate holds against page code even when the creator's
// theme picks a low-contrast accent. Pass an explicit `disableRules` list only to
// scope out a rule a given page legitimately can't satisfy.
export async function expectNoA11yViolations(
  page: Page,
  { disableRules = [] }: { disableRules?: string[] } = {},
) {
  const builder = new AxeBuilder({ page })
  if (disableRules.length) builder.disableRules(disableRules)
  const { violations } = await builder.analyze()
  expect(violations).toEqual([])
}
