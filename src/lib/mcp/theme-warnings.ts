import type { ThemeColorSlots, TimelineTheme } from '~/lib/domain/types'

// Advisory contrast checks for set_timeline_theme — pure synchronous math, kept
// out of warnings.ts (which is patch-op-scoped and network-heavy). Like patch
// warnings, these never block the write; the client fixes them with a follow-up.

// Default canvas background per scheme — mirrors --color-bg-base in
// packages/ui/src/theme/tokens.css (the canvas pane resolves
// --xy-background-color to bg-base). Keep in sync with tokens.css.
export const DEFAULT_CANVAS_BG = { dark: '#08090c', light: '#fafbfc' } as const

// WCAG 1.4.11 non-text contrast — accents drive edge strokes, rails, dots and
// badges, not body text, so 3:1 (not 4.5:1) is the bar.
const MIN_ACCENT_CONTRAST = 3

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.slice(1)
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const ACCENT_SLOTS = ['accentPrimary', 'accentStory', 'accentInfluence', 'accentDialogue', 'accentEra'] as const

export function themeContrastWarnings(theme: TimelineTheme | null): string[] {
  if (!theme?.colors) return []
  const warnings: string[] = []
  for (const scheme of ['dark', 'light'] as const) {
    const slots: ThemeColorSlots | undefined = theme.colors[scheme]
    if (!slots) continue
    const bg = slots.canvasBg ?? DEFAULT_CANVAS_BG[scheme]
    for (const slot of ACCENT_SLOTS) {
      const hex = slots[slot]
      if (!hex) continue
      const ratio = contrastRatio(hex, bg)
      if (ratio < MIN_ACCENT_CONTRAST) {
        warnings.push(
          `${scheme} ${slot} ${hex} has ${ratio.toFixed(1)}:1 contrast against the ${scheme} canvas background ` +
            `${bg} (minimum ${MIN_ACCENT_CONTRAST}:1 for non-text UI) — it will be hard to see; pick a ` +
            `${scheme === 'dark' ? 'lighter' : 'darker'} shade`,
        )
      }
    }
  }
  const defined = (['dark', 'light'] as const).filter((s) => theme.colors?.[s])
  if (defined.length === 1) {
    const missing = defined[0] === 'dark' ? 'light' : 'dark'
    warnings.push(
      `theme defines colors only for ${defined[0]} — ${missing}-mode viewers see the default accents; ` +
        `add a ${missing} scheme if you want the theme everywhere`,
    )
  }
  return warnings
}
