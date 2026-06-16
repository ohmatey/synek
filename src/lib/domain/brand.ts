import { z } from 'zod'
import { HEX_COLOR_RE } from './theme'

// The brand-kit contract (stories-first pivot, slice 2). Synek ADOPTS the
// Realscript brand SCHEMA so a kit authored locally here is shape-compatible with
// what the Realscript `get_brand_kit` MCP tool returns (its `BrandLLMContext`) —
// identity, guidelines, the structured voice schema, and visual identity. This is
// the LOCAL authoring shape only: no Realscript fetch, no encrypted Realscript
// key, no brand sync (all explicitly LATER). Validated identically by the brand
// server fns and (later) any MCP brand tool. Kept apart from types.ts so the zod
// dependency stays out of the type-only module, like theme.ts.

const hexColor = z.string().regex(HEX_COLOR_RE, 'must be a hex color like "#8a6d3b" or "#fff"')

// --- the structured voice schema (Realscript's `voice`) --------------------
// Mirrors what the brand-story skill quotes: personality traits with an
// intensity, do/don't writing rules, a tone spectrum (labelled sliders), example
// phrases, content-type variations, and a preferred/avoided vocabulary.

export const RULE_TYPES = ['do', 'dont'] as const
export const JARGON_LEVELS = ['none', 'minimal', 'moderate', 'heavy'] as const
export const FONT_CATEGORIES = ['display', 'heading', 'body', 'mono'] as const

export const personalityTraitSchema = z.strictObject({
  trait: z.string().trim().min(1).max(60),
  // 1–10 emphasis; the voice leads with the high-intensity traits.
  intensity: z.number().int().min(1).max(10),
})

export const writingRuleSchema = z.strictObject({
  type: z.enum(RULE_TYPES),
  rule: z.string().trim().min(1).max(280),
})

export const toneDimensionSchema = z.strictObject({
  dimension: z.string().trim().min(1).max(60),
  labelLow: z.string().trim().min(1).max(60),
  labelHigh: z.string().trim().min(1).max(60),
  // 0–100 slider; 50 = balanced.
  value: z.number().int().min(0).max(100),
})

export const contentTypeVariationSchema = z.strictObject({
  contentType: z.string().trim().min(1).max(60),
  guidance: z.string().trim().min(1).max(500),
})

export const vocabularySchema = z.strictObject({
  preferred: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  avoided: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  jargonLevel: z.enum(JARGON_LEVELS).optional(),
})

export const voiceSchemaSchema = z.strictObject({
  version: z.number().int().min(1).default(1),
  personalityTraits: z.array(personalityTraitSchema).max(20).default([]),
  writingRules: z.array(writingRuleSchema).max(40).default([]),
  toneSpectrum: z.array(toneDimensionSchema).max(20).default([]),
  examplePhrases: z.array(z.string().trim().min(1).max(280)).max(40).default([]),
  contentTypeVariations: z.array(contentTypeVariationSchema).max(20).default([]),
  vocabulary: vocabularySchema.optional(),
})

// --- visual identity -------------------------------------------------------

export const brandFontSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  family: z.string().trim().min(1).max(200),
  category: z.enum(FONT_CATEGORIES).optional(),
  weights: z.array(z.string().trim().min(1).max(10)).max(12).optional(),
})

export const coreValueSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
})

// --- the full kit ----------------------------------------------------------
// strictObject throughout (like timelineThemeSchema): an unknown key is an
// instructive error, not something to silently strip. Everything past name/slug
// is optional so a half-authored kit still validates — the editor saves drafts.

export const brandKitSchema = z.strictObject({
  // Identity
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  industries: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  targetAudience: z.string().trim().max(1000).optional(),
  brandAttributes: z.array(z.string().trim().min(1).max(60)).max(20).default([]),

  // Visual identity
  colors: z.array(hexColor).max(24).default([]),
  fonts: z.array(brandFontSchema).max(12).default([]),
  logoUrl: z.string().trim().url().max(2000).optional(),
  visualAesthetic: z.string().trim().max(1000).optional(),

  // Guidelines / throughline
  mission: z.string().trim().max(1000).optional(),
  vision: z.string().trim().max(1000).optional(),
  coreValues: z.array(coreValueSchema).max(20).default([]),
  keyMessages: z.array(z.string().trim().min(1).max(280)).max(20).default([]),

  // Structured voice
  voiceSchema: voiceSchemaSchema.optional(),
})

export type BrandKit = z.infer<typeof brandKitSchema>
export type BrandVoiceSchema = z.infer<typeof voiceSchemaSchema>
export type BrandFont = z.infer<typeof brandFontSchema>

// A blank kit the editor seeds a brand-new brand with (the name carried in from
// the create dialog, the slug from the row). Everything else empty/draft.
export function emptyBrandKit(name: string, slug: string): BrandKit {
  return brandKitSchema.parse({ name, slug })
}
