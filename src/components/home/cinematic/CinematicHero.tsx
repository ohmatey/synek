import { Link } from '@tanstack/react-router'
import { KeyRound, Plus } from 'lucide-react'

// The new-creator empty hero (Wren §4 / PRD US7). Shown ONLY on the all-scope home
// when the account is truly empty (no timelines, stories, or entities). Project-
// filtered empties and has-content-no-stories are handled by per-group empty states
// now, not a full hero (ask #8) — so this hero has a single state.
export function CinematicHero({
  hasApiKey,
  onNewTimeline,
}: {
  hasApiKey: boolean
  onNewTimeline: () => void
}) {
  return (
    <section className="ch-hero" data-wash data-empty aria-label="Get started">
      <div className="ch-hero-body">
        <h1 className="ch-empty-title">Your world starts here.</h1>
        <p className="ch-empty-body">Build a timeline, write a story, and publish it to the world.</p>
        <div className="ch-hero-actions">
          <button type="button" className="ch-play" onClick={onNewTimeline}>
            <Plus aria-hidden="true" />
            New timeline
          </button>
          {!hasApiKey && (
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
