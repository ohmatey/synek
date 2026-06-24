import type { ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Globe, KeyRound, Layers, Rocket, UserRound } from 'lucide-react'
import type { CreateMode } from '../NewStoryDialog'

// A "story starter" — a prompt scaffold that opens the create dialog pre-filled. Not
// seeded content (there's no public discovery; ADR 0005) — just an opinionated
// jumping-off point that also teaches the story-vs-series distinction by example.
type Starter = {
  id: string
  icon: ComponentType<{ className?: string }>
  tone: 'amber' | 'blue' | 'teal'
  title: string
  body: string
  mode: CreateMode
  topic: string
}

const STARTERS: Starter[] = [
  {
    id: 'technology',
    icon: Rocket,
    tone: 'amber',
    title: 'The rise of a technology',
    body: 'Eras, players and breakthroughs over time.',
    mode: 'series',
    topic: 'the eras, key players and breakthroughs that drove this technology forward',
  },
  {
    id: 'figure',
    icon: UserRound,
    tone: 'blue',
    title: 'A figure through time',
    body: 'A biographical arc, start to legacy.',
    mode: 'story',
    topic: 'a biographical arc — the early life, turning points, and legacy',
  },
  {
    id: 'place',
    icon: Globe,
    tone: 'teal',
    title: 'A place across eras',
    body: 'One location, mapped on the globe.',
    mode: 'series',
    topic: 'one place across the eras — who shaped it and what happened where',
  },
]

// The new-creator empty state (Wren redesign). Shown ONLY on the all-scope home when
// the account is truly empty. Leads with STORY and SERIES (the product) — timeline is
// the substrate, demoted to a text link. Below the hero: a connect-MCP nudge (the
// onboarding backbone — most new users have no client wired yet) and three story
// starters that open the create dialog pre-filled.
export function CinematicHero({
  hasApiKey,
  onStart,
  onNewTimeline,
}: {
  hasApiKey: boolean
  onStart: (mode: CreateMode, preset?: { title?: string; topic?: string }) => void
  onNewTimeline: () => void
}) {
  return (
    <>
      <section className="ch-hero" data-wash data-empty aria-label="Get started">
        <div className="ch-hero-body">
          <h1 className="ch-empty-title">Every history starts with a story.</h1>
          <p className="ch-empty-body">
            Build an immersive, serialized story on a timeline canvas — then share it with the world.
          </p>
          <div className="ch-hero-actions">
            <button type="button" className="ch-play" autoFocus onClick={() => onStart('story')}>
              <BookOpen aria-hidden="true" />
              New story
            </button>
            <button type="button" className="ch-secondary" onClick={() => onStart('series')}>
              <Layers aria-hidden="true" />
              New series
            </button>
          </div>
          <p className="ch-empty-sub">
            or{' '}
            <button type="button" className="ch-textlink" onClick={onNewTimeline}>
              start with a timeline
            </button>
          </p>
        </div>
      </section>

      <div className="ch-onboard">
        {!hasApiKey && (
          <div className="ch-nudge" role="note">
            <KeyRound className="ch-nudge-icon" aria-hidden="true" />
            <div>
              <p className="ch-nudge-title">Connect your Claude to start building</p>
              <p className="ch-nudge-body">
                Stories and timelines are built by your Claude client over MCP. Paste the endpoint into Claude
                Desktop or Claude Code, then tell Claude what to build.
              </p>
              <Link to="/api-keys" className="ch-nudge-link">
                Get your key
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        )}

        <section className="ch-starters" aria-label="Story starters">
          <p className="ch-starters-label">Story starters</p>
          <div className="ch-starter-grid">
            {STARTERS.map((s) => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  type="button"
                  className="ch-starter"
                  onClick={() => onStart(s.mode, { title: s.title, topic: s.topic })}
                >
                  <span className="ch-starter-icon" data-tone={s.tone}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="ch-starter-title">{s.title}</span>
                  <span className="ch-starter-body">{s.body}</span>
                  <span className="ch-starter-tag" data-tone={s.tone}>
                    {s.mode === 'series' ? 'Series-ready' : 'Single story'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}
