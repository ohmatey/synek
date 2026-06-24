import type { BrandKit, BrandFont } from '~/lib/domain/brand'
import type { TimelineTheme, ThemeFont } from '~/lib/domain/types'
import { HEX_COLOR_RE } from '~/lib/domain/theme'

// Map a brand kit's visual identity onto a TimelineTheme — the ONE-SHOT seed when a
// brand is applied to a story/series (locked decision: propose-then-tweak; the result
// is written into the scope's `theme` and freely editable, NOT bound live). Heuristic
// by design: a sensible starting point, not a precise design system. Returns null when
// the kit has nothing visual to seed (no usable colors, fonts, or aesthetic), so the
// caller leaves the existing theme untouched.

// Brand palette → the five accent slots. resolveThemeVars already does per-scheme
// contrast adjustment (readableOnWash/inkOn), so the SAME brand hexes work for both
// dark and light — we don't try to invent a second palette. canvasBg is deliberately
// left unset (the tuned defaults win) to avoid contrast regressions.
function deriveColors(palette: string[]): TimelineTheme['colors'] | null {
  const ok = palette.filter((c) => HEX_COLOR_RE.test(c))
  if (ok.length === 0) return null
  const at = (i: number) => ok[i] ?? ok[i % ok.length] ?? ok[0]
  const slots = {
    accentPrimary: at(0),
    accentStory: at(1),
    accentInfluence: at(2),
    accentDialogue: at(3),
    accentEra: at(4),
  }
  return { dark: slots, light: slots }
}

// Brand font family → the nearest curated display-font key.
function mapFont(fonts: BrandFont[]): ThemeFont | undefined {
  // Prefer a display/heading font; fall back to the first font of any kind.
  const pick =
    fonts.find((f) => f.category === 'display' || f.category === 'heading') ?? fonts[0]
  if (!pick) return undefined
  const fam = `${pick.family} ${pick.name}`.toLowerCase()
  if (/\bmono|mononoki|courier|consolas|menlo\b/.test(fam)) return 'mono'
  if (/\bslab|rockwell|clarendon|roboto slab\b/.test(fam)) return 'slab'
  if (/\bround|comfortaa|quicksand|nunito\b/.test(fam)) return 'rounded'
  if (/serif|garamond|georgia|playfair|merriweather|times/.test(fam)) return 'serif'
  if (/grotesk|helvetica|inter|arial|neue|grotesque|geist|aktiv/.test(fam)) return 'grotesk'
  return 'default'
}

export function deriveThemeFromBrand(kit: BrandKit | null | undefined): TimelineTheme | null {
  if (!kit) return null
  const colors = deriveColors(kit.colors ?? [])
  const display = mapFont(kit.fonts ?? [])
  const imageStyle = kit.visualAesthetic?.trim()?.slice(0, 500) || undefined
  const mood = (kit.brandAttributes ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((a) => a.slice(0, 40))

  // Nothing visual to seed → leave the existing theme alone.
  if (!colors && !display && !imageStyle && mood.length === 0) return null

  const theme: TimelineTheme = {}
  if (kit.name) theme.name = kit.name.slice(0, 60)
  if (colors) theme.colors = colors
  if (display) theme.font = { display }
  if (imageStyle) theme.imageStyle = imageStyle
  if (mood.length) theme.mood = mood
  return theme
}
