// M.4 viral-loop attribution (docs/product/prd/understand-app.md §M.4). A reader who
// converts from a shared public /s/$slug page reaches /signup carrying the originating
// story slug, so the new account's `signup` event can be joined back to the share that
// drove it — the numerator of the viral coefficient (signups_from_shares / shares).
//
// This is the ONE pure mapping from the signup screen's search params to the signup
// attribution props. Kept framework-free so it is unit-verifiable
// (scripts/verify-funnel.ts) without spinning up a browser or a PostHog key.

export type SignupSource = 'shared_story' | 'direct'

export interface SignupAttribution {
  /** The acquisition channel that produced this signup. */
  source: SignupSource
  /** The originating shared-story slug — present only when source === 'shared_story'. */
  slug?: string
}

/** The shape of the /signup route's search params relevant to attribution. */
export interface SignupRefSearch {
  ref?: string
  slug?: string
}

/**
 * Map the signup screen's search params to attribution props. A `ref=story` with a
 * non-empty `slug` is a shared-story conversion; everything else is a direct signup.
 * Total and defensive — any missing/garbage input degrades to `{ source: 'direct' }`.
 */
export function parseSignupAttribution(search: SignupRefSearch | undefined): SignupAttribution {
  const slug = typeof search?.slug === 'string' ? search.slug.trim() : ''
  if (search?.ref === 'story' && slug) return { source: 'shared_story', slug }
  return { source: 'direct' }
}

/** The query string a "Make your own" CTA appends so a signup is attributed to a share. */
export function sharedStorySignupHref(slug: string): string {
  return `/signup?ref=story&slug=${encodeURIComponent(slug)}`
}
