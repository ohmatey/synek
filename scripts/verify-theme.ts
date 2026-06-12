import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { ensureTimeline, getTimelineMeta, setTimelineTheme } from '../src/lib/db/graph'
import { timelineThemeSchema } from '../src/lib/domain/theme'
import { contrastRatio, themeContrastWarnings, DEFAULT_CANVAS_BG } from '../src/lib/mcp/theme-warnings'
import type { TimelineTheme } from '../src/lib/domain/types'

// Proves the per-timeline theme path WITHOUT the SDK or a model: the zod
// contract, the owner-scoped replace/clear write, and the contrast-warning
// helper. Run under Node: `bun run verify:theme` (own DB via DATABASE_URL).

const TL = 'verify-theme'
const VERIFY_EMAIL = 'verify@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureVerifyUser(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: VERIFY_EMAIL, password: 'verify-password-123', name: 'Verify' } })
  } catch {
    // already exists — fine
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, VERIFY_EMAIL)).get()
  if (!row) throw new Error('could not create the verify user')
  return row.id
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Theme verify')

  // --- zod contract ----------------------------------------------------------
  const good: TimelineTheme = {
    name: 'Imperial Marble',
    colors: {
      dark: { accentPrimary: '#9b8cff', accentStory: '#e0a458', canvasBg: '#0a0d14' },
      light: { accentPrimary: '#2752c8', accentStory: '#b87716' },
    },
    font: { display: 'serif' },
    texture: 'paper',
    imageStyle: 'engraved 19th-century lithograph, muted sepia',
    mood: ['stately', 'weathered'],
  }
  assert(timelineThemeSchema.safeParse(good).success, 'schema accepts a full valid theme')
  assert(timelineThemeSchema.safeParse({ colors: { dark: { accentEra: '#fff' } } }).success, 'schema accepts 3-digit hex')
  assert(!timelineThemeSchema.safeParse({ colors: { dark: { accentEra: 'red' } } }).success, 'schema rejects named colors')
  assert(!timelineThemeSchema.safeParse({ colors: { dark: { accentEra: '#12345' } } }).success, 'schema rejects 5-digit hex')
  assert(
    !timelineThemeSchema.safeParse({ colors: { dark: { accent_primary: '#ffffff' } } }).success,
    'schema rejects unknown slot keys (strict)',
  )
  assert(!timelineThemeSchema.safeParse({ font: { display: 'comic-sans' } }).success, 'schema rejects unknown fonts')
  assert(!timelineThemeSchema.safeParse({ texture: 'velvet' }).success, 'schema rejects unknown textures')

  // --- persist + read back ----------------------------------------------------
  setTimelineTheme(TL, ownerId, good)
  const stored = getTimelineMeta(TL)?.theme
  assert(JSON.stringify(stored) === JSON.stringify(good), 'theme round-trips through the JSON column')

  // --- replace, not merge -----------------------------------------------------
  const slim: TimelineTheme = { colors: { dark: { accentPrimary: '#45b8ac' } } }
  setTimelineTheme(TL, ownerId, slim)
  const replaced = getTimelineMeta(TL)?.theme
  assert(replaced?.colors?.dark?.accentStory === undefined, 'replace drops slots absent from the new theme')
  assert(replaced?.font === undefined, 'replace drops font/texture/meta too')

  // --- non-owner no-ops -------------------------------------------------------
  setTimelineTheme(TL, 'not-the-owner', good)
  assert(
    JSON.stringify(getTimelineMeta(TL)?.theme) === JSON.stringify(slim),
    'a non-owner write no-ops (owner-scoped WHERE)',
  )

  // --- null clears -------------------------------------------------------------
  setTimelineTheme(TL, ownerId, null)
  assert(getTimelineMeta(TL)?.theme === null, 'null clears the theme')

  // --- contrast helper ----------------------------------------------------------
  assert(Math.abs(contrastRatio('#fff', '#000') - 21) < 0.01, '3-digit hex expands (white/black ≈ 21:1)')
  assert(themeContrastWarnings(null).length === 0, 'null theme → no warnings')

  const invisible = themeContrastWarnings({ colors: { dark: { accentPrimary: '#0a0a0a' } } })
  assert(invisible.some((w) => w.includes('accentPrimary')), 'near-black accent on the dark canvas warns')

  const fine = themeContrastWarnings({
    colors: { dark: { accentPrimary: '#9b8cff' }, light: { accentPrimary: '#2752c8' } },
  })
  assert(fine.length === 0, 'good accents in both schemes → no warnings')

  const darkOnly = themeContrastWarnings({ colors: { dark: { accentPrimary: '#9b8cff' } } })
  assert(darkOnly.length === 1 && darkOnly[0]!.includes('only for dark'), 'single-scheme theme gets the soft note')

  // A light accent that fails on the default light canvas passes over a custom
  // dark canvasBg — the check compares against the theme's own wash.
  const failsOnDefault = themeContrastWarnings({ colors: { light: { accentPrimary: '#e8e8e8' } } })
  assert(
    failsOnDefault.some((w) => w.includes(DEFAULT_CANVAS_BG.light)),
    'pale accent fails against the default light canvas',
  )
  const passesOnCustom = themeContrastWarnings({
    colors: { light: { accentPrimary: '#e8e8e8', canvasBg: '#1a1a2e' } },
  })
  assert(
    !passesOnCustom.some((w) => w.includes('accentPrimary')),
    'the same accent passes against a custom dark canvasBg',
  )

  console.log('\nTheme path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
