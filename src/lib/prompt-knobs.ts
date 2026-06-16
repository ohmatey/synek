import type { TimelineTheme } from '~/lib/domain/types'
import type { BrandKit } from '~/lib/domain/brand'

// The "Storyteller's console" knobs — the small set of expressive controls the
// prompt dialogs expose. They shape the prompt by APPENDING directives to the base
// text a builder produced (never editing the builders), so a knob amplifies every
// prompt uniformly and 'standard'/none stays byte-identical to today's prompts.
// One vocabulary, shared by the New Story dialog, New Timeline dialog and the
// generic PromptDialog (depth only — genre/brand are story-specific).

// --- Depth: amplify the breadth/depth of what a prompt adds ----------------

export const DEPTHS = ['quick', 'standard', 'deep'] as const
export type Depth = (typeof DEPTHS)[number]

export const DEPTH_META: Record<Depth, { label: string; hint: string }> = {
  quick: { label: 'Quick', hint: 'Just the essential few, kept tight' },
  standard: { label: 'Standard', hint: 'A balanced, rich pass (default)' },
  deep: { label: 'Deep', hint: 'Exhaustive — go wide and thorough' },
}

// 'standard' is the builders' own baseline → appends nothing.
export function depthDirective(depth: Depth): string | null {
  switch (depth) {
    case 'quick':
      return (
        'Scope — keep it tight: add only the few most essential, highest-signal items. ' +
        'Favour getting each one right (dates, a citation, an image) over covering everything.'
      )
    case 'deep':
      return (
        'Scope — go broad and deep: be exhaustive. Add every significant item, the secondary ' +
        'figures, works and connections around them, and richer detail on each (precise dates, ' +
        'multiple citations, images, edges). Cover the whole subject, not just the highlights.'
      )
    default:
      return null
  }
}

// --- Genre: a story's voice, with a matching suggested theme ---------------
// "Genre suggests a theme" — picking one injects a voice directive into the story
// prompt AND offers a curated TimelineTheme the user can apply/tune. Themes carry
// both dark + light schemes and AI-facing imageStyle/mood, matching the timeline
// theme contract. Accents are tuned for reasonable contrast on their canvasBg.

export const GENRES = ['epic', 'noir', 'documentary', 'fable', 'mythic'] as const
export type Genre = (typeof GENRES)[number]

export type GenrePreset = {
  id: Genre
  label: string
  blurb: string
  directive: string
  theme: TimelineTheme
}

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: 'epic',
    label: 'Epic',
    blurb: 'Sweeping, heroic, cinematic',
    directive:
      'Genre — Epic: tell it with sweep and stakes. Big, cinematic scenes; rising tension; a sense ' +
      'of consequence and destiny. Vivid but grounded — earn the grandeur with real detail.',
    theme: {
      name: 'Golden Epic',
      colors: {
        dark: { accentPrimary: '#f0c14b', accentStory: '#f0c14b', accentInfluence: '#7aa2ff', accentEra: '#c98a3a', canvasBg: '#0b1020' },
        light: { accentPrimary: '#9a6b16', accentStory: '#9a6b16', accentInfluence: '#2f4f8f', accentEra: '#8a5a1f', canvasBg: '#faf7ef' },
      },
      font: { display: 'slab' },
      texture: 'paper',
      imageStyle: 'sweeping cinematic oil painting, golden hour, dramatic chiaroscuro',
      mood: ['heroic', 'grand', 'sweeping'],
    },
  },
  {
    id: 'noir',
    label: 'Noir',
    blurb: 'Tense, shadowed, hard-boiled',
    directive:
      'Genre — Noir: tell it tense and shadowed. Terse, atmospheric prose; moral ambiguity; the feel ' +
      'of a case unfolding. Let dread and consequence hang in the air — never melodrama.',
    theme: {
      name: 'Shadow & Smoke',
      colors: {
        dark: { accentPrimary: '#c9d1d9', accentStory: '#d4534a', accentInfluence: '#8a93a3', accentEra: '#5f6672', canvasBg: '#0a0a0c' },
        light: { accentPrimary: '#2c2c2e', accentStory: '#a32d2d', accentInfluence: '#5f5e5a', accentEra: '#444441', canvasBg: '#f3f3f4' },
      },
      font: { display: 'grotesk' },
      texture: 'none',
      imageStyle: 'high-contrast black-and-white film-noir still, deep shadows, venetian-blind light',
      mood: ['tense', 'shadowed', 'moody'],
    },
  },
  {
    id: 'documentary',
    label: 'Documentary',
    blurb: 'Measured, factual, clear',
    directive:
      'Genre — Documentary: tell it measured and clear, like a good documentary narrator. Let the ' +
      'facts carry the weight; explain cause and effect plainly; quote sources. Authoritative, not dry.',
    theme: {
      name: 'Archive',
      colors: {
        dark: { accentPrimary: '#58a6ff', accentStory: '#3fb950', accentInfluence: '#a371f7', accentEra: '#8b949e', canvasBg: '#0d1117' },
        light: { accentPrimary: '#185fa5', accentStory: '#2d7d33', accentInfluence: '#6f42c1', accentEra: '#57606a', canvasBg: '#ffffff' },
      },
      font: { display: 'default' },
      texture: 'none',
      imageStyle: 'clean documentary photograph, natural light, archival',
      mood: ['factual', 'clear', 'measured'],
    },
  },
  {
    id: 'fable',
    label: 'Fable',
    blurb: 'Warm, storybook, gentle',
    directive:
      'Genre — Fable: tell it warm and storybook, with a gentle narrator. Clear images, a little ' +
      'wonder, a felt moral — but stay faithful to what really happened; no invented facts.',
    theme: {
      name: 'Storybook',
      colors: {
        dark: { accentPrimary: '#e8a87c', accentStory: '#c38d9e', accentInfluence: '#85b79d', accentEra: '#c9a36b', canvasBg: '#161310' },
        light: { accentPrimary: '#b5651d', accentStory: '#8a3b5a', accentInfluence: '#3b7a5e', accentEra: '#936a2b', canvasBg: '#fdf8f1' },
      },
      font: { display: 'rounded' },
      texture: 'paper',
      imageStyle: 'soft watercolor storybook illustration, warm gouache, gentle edges',
      mood: ['warm', 'whimsical', 'gentle'],
    },
  },
  {
    id: 'mythic',
    label: 'Mythic',
    blurb: 'Timeless, sacred, elemental',
    directive:
      'Genre — Mythic: tell it timeless and elemental, with the cadence of legend. Archetypes, ' +
      'symbols and ritual weight — but anchored in real events and sources, not fantasy.',
    theme: {
      name: 'Ancient Fresco',
      colors: {
        dark: { accentPrimary: '#b6a4ff', accentStory: '#5dcaa5', accentInfluence: '#d18ad1', accentEra: '#9a7bd1', canvasBg: '#0d0b16' },
        light: { accentPrimary: '#534ab7', accentStory: '#0f6e56', accentInfluence: '#993556', accentEra: '#3c3489', canvasBg: '#f7f5fb' },
      },
      font: { display: 'serif' },
      texture: 'dots',
      imageStyle: 'ancient fresco, gold leaf, weathered pigment, mythological',
      mood: ['timeless', 'sacred', 'elemental'],
    },
  },
]

export function genrePreset(id: Genre): GenrePreset | null {
  return GENRE_PRESETS.find((g) => g.id === id) ?? null
}

// --- Brand costume: a compact, prompt-injectable voice digest ---------------
// The few highest-signal lines a writer needs to stay on-brand — NOT the whole kit
// (keeps the prompt short). Returns null when the kit carries nothing voice-shaping.

export function brandVoiceDirective(kit: BrandKit): string | null {
  const v = kit.voiceSchema
  const lines: string[] = []

  const traits = (v?.personalityTraits ?? [])
    .slice()
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 5)
    .map((t) => t.trait)
  if (traits.length) lines.push(`personality: ${traits.join(', ')}`)

  const dos = (v?.writingRules ?? []).filter((r) => r.type === 'do').slice(0, 4).map((r) => r.rule)
  if (dos.length) lines.push(`do: ${dos.join('; ')}`)
  const donts = (v?.writingRules ?? []).filter((r) => r.type === 'dont').slice(0, 4).map((r) => r.rule)
  if (donts.length) lines.push(`don't: ${donts.join('; ')}`)

  const tone = (v?.toneSpectrum ?? [])
    .slice(0, 4)
    .map((t) => `${t.dimension} ${t.value}/100 (${t.labelLow}↔${t.labelHigh})`)
  if (tone.length) lines.push(`tone: ${tone.join(', ')}`)

  const pref = v?.vocabulary?.preferred?.slice(0, 8) ?? []
  if (pref.length) lines.push(`prefer: ${pref.join(', ')}`)
  const avoid = v?.vocabulary?.avoided?.slice(0, 8) ?? []
  if (avoid.length) lines.push(`avoid: ${avoid.join(', ')}`)

  const phrases = v?.examplePhrases?.slice(0, 3) ?? []
  if (phrases.length) lines.push(`voice examples: ${phrases.map((p) => `"${p}"`).join(' ')}`)

  const attrs = kit.brandAttributes?.length ? ` (${kit.brandAttributes.join(', ')})` : ''
  if (!lines.length && !attrs && !kit.tagline) return null

  const head = `Write in the voice of the "${kit.name}" brand${kit.tagline ? ` — ${kit.tagline}` : ''}${attrs}.`
  return lines.length ? `${head}\n- ${lines.join('\n- ')}` : head
}

// --- Composition: append the active knobs to a base prompt ------------------
// Order: base → genre → brand voice → depth → (the dialog appends user context
// after this). Genre's theme is embedded only when asked (the New Story flow rides
// the chosen theme through write_story's `theme` field).

export type StoryKnobs = {
  depth?: Depth
  genre?: Genre | null
  brandVoice?: string | null
  // Embed the genre/chosen theme as JSON so the agent sets it via write_story.
  storyTheme?: TimelineTheme | null
}

export function composeStoryKnobs(base: string, knobs: StoryKnobs): string {
  const parts: string[] = [base]
  const g = knobs.genre ? genrePreset(knobs.genre) : null
  if (g) parts.push(g.directive)
  if (knobs.brandVoice) parts.push(knobs.brandVoice)
  if (knobs.storyTheme) {
    parts.push(
      "Also set this story's own visual theme by passing this exact `theme` object to write_story " +
        '(it is independent of the timeline and renders on the shared story page):\n' +
        JSON.stringify(knobs.storyTheme),
    )
  }
  const d = knobs.depth ? depthDirective(knobs.depth) : null
  if (d) parts.push(d)
  return parts.join('\n\n')
}
