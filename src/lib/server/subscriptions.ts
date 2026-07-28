import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  follow as dbFollow,
  unfollow as dbUnfollow,
  isFollowing as dbIsFollowing,
} from '~/lib/db/subscriptions'
import { getSeries } from '~/lib/db/series'
import { getCurrentUser, requireUser } from '~/lib/auth/session'

// --- Series subscriptions (local-160) --------------------------------------
// Signed-in FOLLOW toggle. The public /sr/$slug page is no-auth, so the Follow surface
// reads its state through getSeriesFollowState (optional user) and toggles via
// followSeries/unfollowSeries (requireUser). The on-publish email fan-out lives in the
// server-only server/notify-chapter.ts — keeping it out of this module (which the client
// FollowSeriesButton imports) stops the Node-only db/email deps leaking into the browser.

export type SeriesFollowState = { signedIn: boolean; isOwner: boolean; isFollowing: boolean }

// The Follow button's state for the current viewer on a public season page. Never
// throws for an anonymous viewer (the page is public) — it just reports signedIn:false
// so the UI shows the RSS + sign-in nudge instead of a live toggle. isOwner suppresses
// the button (you read your own season, you don't follow it).
export const getSeriesFollowState = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => z.string().parse(id))
  .handler(async ({ data: seriesId }): Promise<SeriesFollowState> => {
    const user = await getCurrentUser()
    if (!user) return { signedIn: false, isOwner: false, isFollowing: false }
    const series = getSeries(seriesId)
    const isOwner = !!series && series.ownerId === user.id
    return { signedIn: true, isOwner, isFollowing: isOwner ? false : dbIsFollowing(seriesId, user.id) }
  })

// Follow a series (signed-in). Gated on the series being PUBLIC (you can only follow
// what you can read) and NOT your own (the owner has the whole dashboard). Idempotent.
export const followSeries = createServerFn({ method: 'POST' })
  .inputValidator((d: { seriesId: string }) => z.object({ seriesId: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { error: 'forbidden' }> => {
    const user = await requireUser()
    const series = getSeries(data.seriesId)
    if (!series || !series.isPublic || series.ownerId === user.id) return { error: 'forbidden' }
    dbFollow(data.seriesId, user.id)
    return { ok: true as const }
  })

export const unfollowSeries = createServerFn({ method: 'POST' })
  .inputValidator((d: { seriesId: string }) => z.object({ seriesId: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser()
    dbUnfollow(data.seriesId, user.id)
    return { ok: true as const }
  })
