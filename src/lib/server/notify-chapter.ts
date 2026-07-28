import { chapterNotifyInfo, listFollowers } from '~/lib/db/subscriptions'
import { sendEmail, newChapterEmailTemplate } from '~/lib/auth/email'

// Server-only chapter-publish email fan-out (local-160). Kept in its OWN module —
// not alongside the followSeries/unfollowSeries createServerFns in server/subscriptions.ts —
// because this is a plain (non-serverFn) export: leaving it there anchors the Node-only
// db + email imports in the client copy of a module that FollowSeriesButton imports,
// dragging better-sqlite3 into the browser bundle (vite build fails on node:url). Its
// only callers are server-side: the MCP tool handlers and the setChapterStatus server fn.

// Absolute origin for links baked into emails (Resend has no request context).
const baseUrl = (): string => (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3001').replace(/\/$/, '')

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
