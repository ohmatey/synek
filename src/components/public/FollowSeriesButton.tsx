import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, BellRing, Rss } from 'lucide-react'
import { toast } from 'sonner'
import { followSeries, getSeriesFollowState, unfollowSeries, type SeriesFollowState } from '~/lib/server/subscriptions'
import { capture } from '~/lib/posthog/client'

// The audience-retention CTA on the public season page (local-160). Two channels:
// a signed-in FOLLOW toggle (emails the reader on each new published chapter) and a
// public RSS link (account-less). Follow state is fetched on mount — the /sr/$slug
// loader is no-auth, so this reads the viewer's session client-side. The series OWNER
// never sees a Follow control (they have the dashboard); everyone sees RSS.
export function FollowSeriesButton({ seriesId, slug }: { seriesId: string; slug: string }) {
  const [state, setState] = useState<SeriesFollowState | null>(null)
  const [busy, setBusy] = useState(false)
  const feedUrl = `/api/sr/${slug}/feed.xml`

  useEffect(() => {
    let live = true
    getSeriesFollowState({ data: seriesId })
      .then((s) => live && setState(s))
      .catch(() => live && setState({ signedIn: false, isOwner: false, isFollowing: false }))
    return () => {
      live = false
    }
  }, [seriesId])

  const toggle = async () => {
    if (busy || !state) return
    setBusy(true)
    const next = !state.isFollowing
    // Optimistic; revert on failure.
    setState({ ...state, isFollowing: next })
    try {
      const res = next ? await followSeries({ data: { seriesId } }) : await unfollowSeries({ data: { seriesId } })
      if ('error' in res) {
        setState({ ...state, isFollowing: !next })
        toast.error('Couldn’t update your subscription.')
        return
      }
      if (next) capture('series_followed', { series_id: seriesId })
      toast.success(next ? 'Following — you’ll be emailed on each new chapter.' : 'Unfollowed.')
    } catch {
      setState({ ...state, isFollowing: !next })
      toast.error('Couldn’t update your subscription.')
    } finally {
      setBusy(false)
    }
  }

  // The owner reads their own season; no follow affordance (RSS still available below).
  const showToggle = state && state.signedIn && !state.isOwner

  return (
    <div className="ps-follow" aria-live="polite">
      {showToggle ? (
        <button
          type="button"
          className="ps-follow-btn"
          onClick={() => void toggle()}
          disabled={busy}
          data-following={state!.isFollowing ? '' : undefined}
          aria-pressed={state!.isFollowing}
        >
          {state!.isFollowing ? <BellRing size={16} aria-hidden /> : <Bell size={16} aria-hidden />}
          {state!.isFollowing ? 'Following' : 'Follow'}
        </button>
      ) : state && !state.isOwner ? (
        // Signed-out: can't follow — nudge to sign in, RSS covers the account-less case.
        <Link to="/login" className="ps-follow-btn">
          <Bell size={16} aria-hidden />
          Sign in to follow
        </Link>
      ) : null}

      <a className="ps-follow-rss" href={feedUrl} target="_blank" rel="noreferrer" aria-label="Subscribe via RSS">
        <Rss size={15} aria-hidden />
        RSS
      </a>
    </div>
  )
}
