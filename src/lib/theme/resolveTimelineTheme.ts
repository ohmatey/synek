import type { ThemeColorSlots, ThemeFont, TimelineTheme } from '~/lib/domain/types'

// Per-timeline theme → the CSS custom properties TimelineCanvas spreads onto
// `.canvas-root` as inline styles. Everything here is computed in JS at RUNTIME:
// inline custom properties resolve per-element, which sidesteps both build-time
// gotchas — lightningcss baking `color-mix(var())` to one theme's value, and
// `:root`-defined alias vars (--primary: var(--color-accent-primary)) whose
// var() refs substitute at :root computed-value time, so overriding the brand
// token alone never reaches anything consumed via the alias. Each alias the
// canvas actually consumes is re-declared explicitly below.

export type ColorScheme = 'light' | 'dark'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function parseHex(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
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

function rgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

// WCAG relative luminance, 0 (black) … 1 (white).
function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

// Brand-default hex per slot and scheme — mirrors tokens.css (accents) and
// --color-bg-base (canvasBg). Used to seed the theme editor's color inputs and
// the settings swatch row for slots the theme leaves unset; keep in sync with
// packages/ui/src/theme/tokens.css.
export const DEFAULT_SLOT_HEX: Record<ColorScheme, Required<ThemeColorSlots>> = {
  dark: {
    accentPrimary: '#3a6df0',
    accentStory: '#e0a458',
    accentInfluence: '#9b8cff',
    accentDialogue: '#6aa9ff',
    accentEra: '#45b8ac',
    canvasBg: '#08090c',
  },
  light: {
    accentPrimary: '#2752c8',
    accentStory: '#b87716',
    accentInfluence: '#6c5ce7',
    accentDialogue: '#2f7adf',
    accentEra: '#2f9389',
    canvasBg: '#fafbfc',
  },
}

// Curated display fonts, keyed by the domain THEME_FONTS enum. `stack: null`
// (default) means "no override" — the canvas inherits the system stack. The
// Variable families are registered by the @fontsource-variable imports in
// styles.css; their woff2 files only download when a family is actually used.
export const THEME_FONT_META: Record<ThemeFont, { label: string; stack: string | null }> = {
  default: { label: 'Default', stack: null },
  serif: { label: 'Serif', stack: "'Source Serif 4 Variable', Georgia, serif" },
  slab: { label: 'Slab', stack: "'Roboto Slab Variable', Rockwell, serif" },
  grotesk: { label: 'Grotesk', stack: "'Space Grotesk Variable', system-ui, sans-serif" },
  mono: { label: 'Mono', stack: "'JetBrains Mono Variable', ui-monospace, monospace" },
  rounded: { label: 'Rounded', stack: "'Nunito Variable', 'Trebuchet MS', sans-serif" },
}

// Look up a slot for a scheme. Accents cross-fall-back to the other scheme so a
// dark-only theme keeps its identity in light mode; canvasBg never does — a
// dark canvas under light chrome breaks ruler/label contrast.
function slot(
  theme: TimelineTheme,
  scheme: ColorScheme,
  key: keyof ThemeColorSlots,
  crossFallback: boolean,
): string | undefined {
  const other: ColorScheme = scheme === 'dark' ? 'light' : 'dark'
  const v = theme.colors?.[scheme]?.[key] ?? (crossFallback ? theme.colors?.[other]?.[key] : undefined)
  // Defense in depth: the zod contract already enforces hex, but a hand-edited
  // DB row shouldn't ride raw strings into inline styles.
  return v && HEX.test(v) ? v : undefined
}

export function resolveThemeVars(theme: TimelineTheme | null, scheme: ColorScheme): Record<string, string> {
  if (!theme) return {}
  const vars: Record<string, string> = {}
  const dark = scheme === 'dark'
  const softAlpha = dark ? 0.18 : 0.14

  const primary = slot(theme, scheme, 'accentPrimary', true)
  if (primary) {
    vars['--color-accent-primary'] = primary
    vars['--primary'] = primary // :root alias (Button, text-primary)
    vars['--ring'] = primary // :root alias (focus-visible rings)
    vars['--xy-edge-stroke-selected'] = primary // :root alias (selected edges)
    vars['--color-focus-ring'] = rgba(primary, 0.55) // @theme value holds color-mix(var()) — baked at :root
    vars['--primary-glow'] = rgba(primary, 0.45) // selection-ring glow (styles.css hook)
    // A pale accent keeps button text readable (white-on-pastel fails).
    if (luminance(primary) > 0.6) vars['--primary-foreground'] = '#14171e'
  }

  const story = slot(theme, scheme, 'accentStory', true)
  if (story) {
    vars['--color-accent-story'] = story
    vars['--story'] = story // :root alias parity
    vars['--color-story-soft'] = rgba(story, softAlpha) // tinted fills, derived in JS
    vars['--story-glow'] = rgba(story, 0.5) // story-lens glow (styles.css hook)
    vars['--story-soft-trans'] = rgba(story, 0.12) // lens-bar fill (styles.css hook)
  }

  const influence = slot(theme, scheme, 'accentInfluence', true)
  if (influence) {
    vars['--color-accent-influence'] = influence
    vars['--influence'] = influence
  }

  const dialogue = slot(theme, scheme, 'accentDialogue', true)
  if (dialogue) {
    vars['--color-accent-dialogue'] = dialogue
    vars['--dialogue'] = dialogue
  }

  const era = slot(theme, scheme, 'accentEra', true)
  if (era) vars['--color-accent-era'] = era

  const bg = slot(theme, scheme, 'canvasBg', false)
  if (bg) {
    vars['--xy-background-color'] = bg // :root alias — the canvas pane wash
    // Pattern dots/lines nudge toward the opposite polarity of the wash.
    vars['--xy-background-pattern-color'] = luminance(bg) > 0.5 ? rgba('#14171e', 0.1) : rgba('#f4f5f7', 0.08)
    vars['--ruler-fade-strong'] = rgba(bg, 0.92) // time-ruler fade (styles.css hook)
    vars['--ruler-fade-clear'] = rgba(bg, 0)
  }

  const fontKey = theme.font?.display
  const stack = fontKey ? (THEME_FONT_META[fontKey]?.stack ?? null) : null
  if (stack) vars['--font-display'] = stack

  return vars
}
