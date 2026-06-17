import { Link } from '@tanstack/react-router'
import type { PublicTimelineCard as PublicTimelineCardDTO } from '~/lib/domain/types'

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// One public timeline in the Explore "Timelines" row — opens the canvas, which
// getGraph serves to anonymous viewers when the timeline is public. Read-only
// surface, so no overflow menu (unlike the home's TimelineCard).
export function PublicTimelineCard({ timeline }: { timeline: PublicTimelineCardDTO }) {
  return (
    <article className="ch-tl-card">
      <Link
        to="/timelines/$id"
        params={{ id: timeline.id }}
        className="ch-tl-open"
        aria-label={`Open “${timeline.title}”`}
      >
        <span className="ch-tl-titlerow">
          <span className="ch-tl-title">{timeline.title}</span>
        </span>
        {timeline.description && <span className="ch-tl-desc">{timeline.description}</span>}
        <span className="ch-tl-date">{dateFmt.format(timeline.createdAt)}</span>
      </Link>
    </article>
  )
}
