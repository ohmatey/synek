import { describe, test, expect } from 'bun:test'
import type { TimelineTheme } from '~/lib/domain/types'
import { themeContrastWarnings } from './theme-warnings'

// Accents cross-fall-back to the other scheme when a theme defines only one
// (resolveThemeVars); canvasBg never does. So a dark-only theme's accents
// still render in light mode — against the LIGHT default canvas background,
// not a "default accent". These cover that resolved state, not just the
// colors the author typed in.

describe('themeContrastWarnings', () => {
  test('no theme or no colors → silent', () => {
    expect(themeContrastWarnings(null)).toEqual([])
    expect(themeContrastWarnings({})).toEqual([])
  })

  test('flags a low-contrast accent against its own scheme background', () => {
    // #1a1c22 is near-black — 1.17:1 against the near-black dark wash.
    const theme: TimelineTheme = {
      colors: { dark: { accentPrimary: '#1a1c22' }, light: { accentPrimary: '#2752c8' } },
    }
    const warnings = themeContrastWarnings(theme)
    expect(warnings.some((w) => w.startsWith('dark accentPrimary #1a1c22 has'))).toBe(true)
    expect(warnings.some((w) => w.startsWith('light accentPrimary'))).toBe(false)
  })

  test('a dark-only theme is also checked against the light scheme it carries over into', () => {
    // #cccccc reads fine on the near-black dark wash (12.4:1) but fails
    // (1.55:1) against the default LIGHT canvas background it gets
    // cross-faded onto. The old code skipped `light` entirely because
    // theme.colors.light was undefined, so this failure went unreported.
    const theme: TimelineTheme = { colors: { dark: { accentPrimary: '#cccccc' } } }
    const warnings = themeContrastWarnings(theme)
    expect(warnings.some((w) => w.startsWith('dark accentPrimary'))).toBe(false)
    const lightWarning = warnings.find((w) => w.startsWith('light accentPrimary'))
    expect(lightWarning).toBeDefined()
    expect(lightWarning).toContain('carried over from the dark scheme')
  })

  test('does not claim viewers "see the default accents" for the missing scheme', () => {
    const theme: TimelineTheme = { colors: { dark: { accentPrimary: '#3a6df0' } } }
    const warnings = themeContrastWarnings(theme)
    expect(warnings.some((w) => w.includes('see the default accents'))).toBe(false)
    expect(warnings.some((w) => w.includes('accents carried over'))).toBe(true)
  })

  test('a fully-defined theme with good contrast on both schemes is silent', () => {
    const theme: TimelineTheme = {
      colors: {
        dark: { accentPrimary: '#3a6df0' },
        light: { accentPrimary: '#2752c8' },
      },
    }
    expect(themeContrastWarnings(theme)).toEqual([])
  })
})
