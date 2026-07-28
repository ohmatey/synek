import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { seriesSubscriptions, stories, storySeries, user } from './schema'
import type { StoryStatus } from '~/lib/domain/types'

// --- series_subscriptions data access (local-160) --------------------------
// The follow/unfollow reads + writes. Owner-scope is NOT the boundary here (the
// subscriber is any signed-in user, not the series owner); the boundary is "this
// series exists and is public", enforced in the server layer before follow. The db
// layer takes ids and trusts its guarded caller, matching db/series.ts.

export type Follower = { userId: string; email: string; unsubscribeToken: string }

// Idempotent follow: insert (seriesId, userId) or return the existing row's token.
// The UNIQUE(seriesId, userId) index makes a double-follow a no-op that still yields
// the same token, so the email always carries a stable unsubscribe link.
export function follow(seriesId: string, userId: string): { unsubscribeToken: string } {
  const existing = db
    .select({ token: seriesSubscriptions.unsubscribeToken })
    .from(seriesSubscriptions)
    .where(and(eq(seriesSubscriptions.seriesId, seriesId), eq(seriesSubscriptions.userId, userId)))
    .get()
  if (existing) return { unsubscribeToken: existing.token }
  const row = db
    .insert(seriesSubscriptions)
    .values({ seriesId, userId })
    .returning({ token: seriesSubscriptions.unsubscribeToken })
    .get()
  return { unsubscribeToken: row!.token }
}

// Unfollow by (seriesId, userId) — the signed-in toggle. No-op if not following.
export function unfollow(seriesId: string, userId: string): void {
  db.delete(seriesSubscriptions)
    .where(and(eq(seriesSubscriptions.seriesId, seriesId), eq(seriesSubscriptions.userId, userId)))
    .run()
}

// Unfollow by the opaque token — the account-less /unsubscribe?token link. Returns
// true when a row was removed (so the page can distinguish a live unsubscribe from a
// stale/already-used link). SQLite's better-sqlite3 exposes the change count on run().
export function unfollowByToken(token: string): boolean {
  const res = db.delete(seriesSubscriptions).where(eq(seriesSubscriptions.unsubscribeToken, token)).run()
  return res.changes > 0
}

export function isFollowing(seriesId: string, userId: string): boolean {
  return !!db
    .select({ id: seriesSubscriptions.id })
    .from(seriesSubscriptions)
    .where(and(eq(seriesSubscriptions.seriesId, seriesId), eq(seriesSubscriptions.userId, userId)))
    .get()
}

// Everything the on-publish notification needs about a chapter, in one join:
// its title + chapter number, its publish status, and its series' identity +
// public flag. Returns null when the story is standalone (no seriesId) or missing,
// so the notify helper can bail cheaply. The series' `isPublic` matters because a
// private season has no public shelf to send readers to (and thus no followers).
export type ChapterNotifyInfo = {
  storyId: string
  storyTitle: string
  chapterNumber: number | null
  status: StoryStatus
  seriesId: string
  seriesTitle: string
  seriesSlug: string
  seriesIsPublic: boolean
}
export function chapterNotifyInfo(storyId: string): ChapterNotifyInfo | null {
  const row = db
    .select({
      storyId: stories.id,
      storyTitle: stories.title,
      chapterNumber: stories.chapterNumber,
      status: stories.status,
      seriesId: storySeries.id,
      seriesTitle: storySeries.title,
      seriesSlug: storySeries.slug,
      seriesIsPublic: storySeries.isPublic,
    })
    .from(stories)
    .innerJoin(storySeries, eq(stories.seriesId, storySeries.id))
    .where(eq(stories.id, storyId))
    .get()
  return row ?? null
}

// Every follower of a series with their email + token, EXCLUDING the series owner
// (you never email yourself about your own chapter). Joins user for the address and
// story_series for the owner id to filter. Backs the on-publish notification fan-out.
export function listFollowers(seriesId: string): Follower[] {
  const ownerId = db.select({ o: storySeries.ownerId }).from(storySeries).where(eq(storySeries.id, seriesId)).get()?.o ?? null
  return db
    .select({
      userId: seriesSubscriptions.userId,
      email: user.email,
      unsubscribeToken: seriesSubscriptions.unsubscribeToken,
    })
    .from(seriesSubscriptions)
    .innerJoin(user, eq(seriesSubscriptions.userId, user.id))
    .where(eq(seriesSubscriptions.seriesId, seriesId))
    .all()
    .filter((f) => f.userId !== ownerId)
}
