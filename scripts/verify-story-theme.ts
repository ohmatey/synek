import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, nodes } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import {
  ensureTimeline,
  loadGraph,
  getTimelineMeta,
  setTimelineTheme,
  resolveTimelineTheme,
} from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, getStoryBySlug, getStoryById, setStoryTheme, getStoryTimelineId } from '../src/lib/db/stories'
import { genrePreset } from '../src/lib/prompt-knobs'
import type { TimelineTheme } from '../src/lib/domain/types'

// Proves INDEPENDENT STORY THEMES without a browser: a story carries its own
// TimelineTheme that round-trips through writeStory/hydrate, set_story_theme's
// db helper writes + owner-guards it, and the public resolution chain prefers the
// story's theme over the timeline's, falling back when the story clears it. Run
// under Node: `DATABASE_URL=verify-story-theme.db tsx scripts/verify-story-theme.ts`.

const TL = 'verify-story-theme'
const VERIFY_EMAIL = 'verify-story-theme@synek.app'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
const eqJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

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

// The public page's resolution chain, replicated (server fn isn't callable here).
function resolvePublicTheme(storyTheme: TimelineTheme | null): TimelineTheme | null {
  return storyTheme ?? resolveTimelineTheme(getTimelineMeta(TL)!)
}

async function main() {
  const ownerId = await ensureVerifyUser()
  ensureTimeline(TL, ownerId, 'Story theme verify')
  db.delete(nodes).where(eq(nodes.timelineId, TL)).run()

  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, [
    { op: 'add_node', ref: 'm', type: 'event', title: 'The moment', start: '2008' },
  ])
  commitPatch(TL, builder, 'verify story theme moment')
  const moment = (results[0] as { id: string }).id

  // The genre presets are real themes — use Noir as the story's own theme.
  const noir = genrePreset('noir')!.theme
  assert(!!noir.colors?.dark && !!noir.colors?.light, 'a genre preset carries both dark + light schemes')

  // 1) write_story can carry a theme; it round-trips through hydrate.
  const { storyId } = writeStory(
    moment,
    { title: 'A themed story', slug: 'a-themed-story-fixed', theme: noir },
    [{ bodyText: 'Once, in shadow.' }],
  )
  const fromSlug = getStoryBySlug('a-themed-story-fixed')
  assert(eqJson(fromSlug!.story.theme, noir), 'writeStory theme round-trips through getStoryBySlug/hydrate')
  assert(eqJson(getStoryById(storyId)!.theme, noir), 'the same theme round-trips through getStoryById')

  // 2) set a DIFFERENT timeline theme; the story theme still wins the chain.
  const epic = genrePreset('epic')!.theme
  setTimelineTheme(TL, ownerId, epic)
  assert(eqJson(getTimelineMeta(TL)!.theme, epic), 'timeline carries its own (different) theme')
  assert(eqJson(resolvePublicTheme(getStoryById(storyId)!.theme), noir), 'public chain: story theme wins over timeline')

  // 3) set_story_theme db helper: owner-guarded, replace-on-write.
  const mythic = genrePreset('mythic')!.theme
  assert(setStoryTheme(storyId, ownerId, mythic) === true, 'setStoryTheme succeeds for the owner')
  assert(eqJson(getStoryById(storyId)!.theme, mythic), 'setStoryTheme replaced the story theme')
  assert(setStoryTheme(storyId, 'not-the-owner', noir) === false, 'setStoryTheme no-ops for a non-owner')
  assert(eqJson(getStoryById(storyId)!.theme, mythic), 'a non-owner write left the theme untouched')

  // 4) clearing the story theme → it inherits the timeline theme at read time.
  assert(setStoryTheme(storyId, ownerId, null) === true, 'setStoryTheme(null) clears the story theme')
  assert(getStoryById(storyId)!.theme === null, 'a cleared story theme reads back null')
  assert(eqJson(resolvePublicTheme(getStoryById(storyId)!.theme), epic), 'public chain: cleared story inherits the timeline theme')

  // 5) the timeline resolver seam used by the MCP tool + RPC.
  assert(getStoryTimelineId(storyId) === TL, 'getStoryTimelineId resolves the story to its timeline')
  assert(getStoryTimelineId('no-such-story') === null, 'getStoryTimelineId returns null for an unknown story')

  console.log('\nindependent story-theme data path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
