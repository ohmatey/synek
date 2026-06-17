import { createServerFn } from '@tanstack/react-start'
import { listPublicStories as dbListPublicStories } from '~/lib/db/stories'
import { listPublicTimelines as dbListPublicTimelines, listPublicNodes as dbListPublicNodes } from '~/lib/db/graph'
import type { PublicNodeCard, PublicStoryCard, PublicTimelineCard } from '~/lib/domain/types'

// The root `/` Explore feed — a PUBLIC, cross-user discovery surface. These RPCs
// are deliberately NOT owner-scoped and need NO session: every row is derived
// from an explicit public flag (a story's own isPublic, a timeline's isPublic),
// so nothing private leaks. Founder decision (2026-06-16) — this intentionally
// supersedes the "public browsing of whole workspaces" deferral in the guardrail.
// Anonymous viewers see the same content as signed-in ones; the only signed-in
// difference is the Projects affordance in the app header.

export const listPublicStories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicStoryCard[]> => dbListPublicStories(),
)

export const listPublicTimelines = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicTimelineCard[]> => dbListPublicTimelines(),
)

export const listPublicNodes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicNodeCard[]> => dbListPublicNodes(),
)
