import { Link } from '@tanstack/react-router'
import { KeyRound, Play, Plus } from 'lucide-react'

// The new-creator empty hero (Wren §4 / PRD US7). Shown ONLY on the all-scope home
// when the account is truly empty (no timelines, no stories). Project-filtered
// empties and has-timelines-no-stories are handled by per-group empty states now,
// not a full hero (ask #8). The featured story uses FeaturedStory, not this.
export function CinematicHero({
  variant,
  projectName,
  hasApiKey,
  onNewTimeline,
  firstTimeline,
  timelineCount,
}: {
  variant: 'new-creator' | 'empty-project' | 'no-stories'
  projectName: string | null
  hasApiKey: boolean
  onNewTimeline: () => void
  firstTimeline?: { id: string; title: string } | null
  timelineCount?: number
}) {
  const copy = {
    'new-creator': {
      title: 'Your world starts here.',
      body: 'Build a timeline, write a story, and publish it to the world.',
    },
    'empty-project': {
      title: `“${projectName ?? 'This project'}” is empty.`,
      body: 'Add a timeline to get started — your connected Claude builds it out.',
    },
    'no-stories': {
      title: 'Write your first story.',
      body:
        timelineCount != null
          ? `${timelineCount} ${timelineCount === 1 ? 'timeline' : 'timelines'} · 0 stories — open a timeline and let your AI tell it.`
          : 'Open a timeline and let your AI tell it.',
    },
  }[variant]

  return (
    <section className="ch-hero" data-wash data-empty aria-label="Get started">
      <div className="ch-hero-body">
        <h1 className="ch-empty-title">{copy.title}</h1>
        <p className="ch-empty-body">{copy.body}</p>
        <div className="ch-hero-actions">
          {variant === 'no-stories' && firstTimeline ? (
            <Link to="/timelines/$id" params={{ id: firstTimeline.id }} className="ch-play">
              <Play aria-hidden="true" />
              Open {firstTimeline.title}
            </Link>
          ) : (
            <button type="button" className="ch-play" onClick={onNewTimeline}>
              <Plus aria-hidden="true" />
              New timeline
            </button>
          )}
          {variant === 'new-creator' && !hasApiKey && (
            <Link to="/api-keys" className="ch-secondary">
              <KeyRound aria-hidden="true" />
              Connect MCP
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
