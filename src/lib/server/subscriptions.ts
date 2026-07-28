import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  follow as dbFollow,
  unfollow as dbUnfollow,
  isFollowing as dbIsFollowing,
  listFollowers,
  chapterNotifyInfo,
} from '~/lib/db/subscriptions'
import { getSeries } from '~/lib/db/series'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import { sendEmail, newChapterEmailTemplate } from '~/lib/auth/email'

// --- Series subscriptions (local-160) --------------------------------------
// Signed-in FOLLOW + on-publish email fan-out. The public /sr/$slug page is no-auth,
// so the Follow surface reads its state through getSeriesFollowState (optional user)
// and toggles via followSeries/unfollowSeries (requireUser). Emailing is best-effort,
// fire-and-forget, and no-ops without RESEND_API_KEY — same posture as verification.

// Absolute origin for links baked into emails (Resend has no request context).
const baseUrl = (): string => (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3001').replace(/\/$/, '')

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

// Fire-and-forget: email every follower that a chapter just went live. Called from the
// two genuine publish moments — a new chapter born `published` (write_story) and a
// draft→published transition (patch_story / setChapterStatus). Best-effort by design:
// it re-validates its own guards (published + in a series + the season is public), never
// throws to the caller, and no-ops silently without RESEND_API_KEY. NOT awaited by the
// tool handlers — a slow/failed email must never block or fail a write.
export async function notifyNewChapter(storyId: string): Promise<void> {
  try {
    const info = chapterNotifyInfo(storyId)
    if (!info || info.status !== 'published' || !info.seriesIsPublic) return
    const followers = listFollowers(info.seriesId)
    if (followers.length === 0) return
    const seasonUrl = `${baseUrl()}/sr/${info.seriesSlug}`
    for (const f of followers) {
      const { subject, html } = newChapterEmailTemplate({
        seriesTitle: info.seriesTitle,
        chapterTitle: info.storyTitle,
        chapterNumber: info.chapterNumber,
        seasonUrl,
        unsubscribeUrl: `${baseUrl()}/unsubscribe?token=${encodeURIComponent(f.unsubscribeToken)}`,
      })
      // Best-effort per recipient; sendEmail already swallows + logs its own errors.
      void sendEmail({ to: f.email, subject, html })
    }
  } catch (err) {
    console.error('[subscriptions] notifyNewChapter failed:', err instanceof Error ? err.message : err)
  }
}
