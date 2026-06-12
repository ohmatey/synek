import { z } from 'zod'
import { THEME_FONTS, THEME_TEXTURES } from './types'

// One theme contract, validated identically by the setTimelineTheme server fn
// and the MCP set_timeline_theme tool. Kept apart from types.ts so the zod
// dependency stays out of the type-only module; still domain-level (no
// drizzle/server imports) like clampPxPerDay.

// #RGB or #RRGGBB, case-insensitive.
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const hexColor = z.string().regex(HEX_COLOR_RE, 'must be a hex color like "#8a6d3b" or "#fff"')

// strictObject throughout: an unknown key is an instructive error for the MCP
// client (teaching it the contract), not something to silently strip.
export const themeColorSlotsSchema = z.strictObject({
  accentPrimary: hexColor.optional(),
  accentStory: hexColor.optional(),
  accentInfluence: hexColor.optional(),
  accentDialogue: hexColor.optional(),
  accentEra: hexColor.optional(),
  canvasBg: hexColor.optional(),
})

export const timelineThemeSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  colors: z
    .strictObject({
      dark: themeColorSlotsSchema.optional(),
      light: themeColorSlotsSchema.optional(),
    })
    .optional(),
  font: z.strictObject({ display: z.enum(THEME_FONTS).optional() }).optional(),
  texture: z.enum(THEME_TEXTURES).optional(),
  imageStyle: z.string().trim().max(500).optional(),
  mood: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
})
