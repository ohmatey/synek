import { parseSignupAttribution, sharedStorySignupHref } from '../src/lib/posthog/attribution'

// Data-layer proof of the M.4 viral-loop attribution join (docs/product/prd/understand-app.md
// §M.4) WITHOUT a browser or a PostHog key: the pure mapping from the /signup search
// params to the `signup` event's attribution props, and the CTA href that produces them.
// The viral coefficient (signups_from_shares / shares) is only computable if a shared-story
// conversion is tagged `source: 'shared_story'` with its originating slug. Run: `bun run verify:funnel`.

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function main() {
  // --- the attributed (shared-story) path ---
  const attr = parseSignupAttribution({ ref: 'story', slug: 'from-shipwreck-to-throne' })
  assert(attr.source === 'shared_story', 'ref=story + slug → source: shared_story')
  assert(attr.slug === 'from-shipwreck-to-throne', 'the originating slug is carried through for the join')

  // --- direct / unattributed paths all degrade to a clean direct signup ---
  assert(parseSignupAttribution(undefined).source === 'direct', 'no search → direct')
  assert(parseSignupAttribution({}).source === 'direct', 'empty search → direct')
  assert(parseSignupAttribution({ ref: 'story' }).source === 'direct', 'ref=story without a slug → direct (no false attribution)')
  assert(parseSignupAttribution({ ref: 'story', slug: '   ' }).source === 'direct', 'blank/whitespace slug → direct')
  assert(parseSignupAttribution({ ref: 'spam', slug: 'x' }).source === 'direct', 'unknown ref → direct (only ref=story attributes)')
  assert(parseSignupAttribution({ slug: 'x' }).source === 'direct', 'slug without ref=story → direct')

  // --- direct signups never leak a slug ---
  assert(parseSignupAttribution({}).slug === undefined, 'a direct signup carries no slug')

  // --- the CTA href round-trips back to a shared_story attribution ---
  const slug = 'a/b weird slug?'
  const href = sharedStorySignupHref(slug)
  assert(href.startsWith('/signup?ref=story&slug='), 'CTA targets /signup with ref=story')
  const parsed = new URL(href, 'https://x.test')
  assert(parsed.searchParams.get('slug') === slug, 'slug is URL-encoded and decodes back to the original (special chars safe)')
  const round = parseSignupAttribution({
    ref: parsed.searchParams.get('ref') ?? undefined,
    slug: parsed.searchParams.get('slug') ?? undefined,
  })
  assert(round.source === 'shared_story' && round.slug === slug, 'CTA → parse round-trips to shared_story + original slug')

  console.log('\n✅ M.4 viral-attribution mapping verified')
}

main()
