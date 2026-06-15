import { Link, useNavigate } from '@tanstack/react-router'
import { KeyRound, Pencil, Play, Plus, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { publishStoryShare } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'
import type { HomeStoryCard, ProjectSummary } from '~/lib/domain/types'

const MAX_CAST = 4

// The cinematic hero (Wren §4 / PRD US1, US2, US7-US9). Three shapes, chosen by the
// caller and passed via props:
//  - a featured story → full-bleed poster (cover or branded amber wash) + Play /
//    Continue writing / Share;
//  - new-creator empty → reduced-height branded wash + "Your world starts here" +
//    New timeline / Connect MCP;
//  - project-filtered-but-empty / has-timelines-no-stories → a directive wash.
// No rotation arrows in slice 1 (DECISION 6); the props shape leaves room for them.
export function CinematicHero(props: HeroProps) {
  if (props.kind === 'story') return <StoryHero {...props} />
  return <EmptyHero {...props} />
}

type HeroProps =
  | {
      kind: 'story'
      story: HomeStoryCard
      // PROJECT label for the eyebrow (the active project, or null = "All scope").
      projectName: string | null
      // The active project id (analytics + the cast-name resolver doesn't need it).
      projectId: string | null
    }
  | {
      kind: 'empty'
      // Which directive copy + CTAs to show.
      variant: 'new-creator' | 'empty-project' | 'no-stories'
      projectName: string | null
      // Whether the owner has any API key (drives the "Connect MCP" CTA presence).
      hasApiKey: boolean
      // Open the New-timeline dialog (scoped to the active project by the parent).
      onNewTimeline: () => void
      // For 'no-stories': the first timeline to nudge "Open […]" toward.
      firstTimeline?: { id: string; title: string } | null
      // Counts for the status line.
      timelineCount?: number
    }

function StoryHero({ story, projectName, projectId }: Extract<HeroProps, { kind: 'story' }>) {
  const navigate = useNavigate()
  const cover = story.coverImage

  const play = () => {
    capture('home_hero_play_clicked', { project_id: projectId ?? undefined, story_id: story.storyId })
    void navigate({ to: '/timelines/$id', params: { id: story.timelineId }, search: { story: story.storyId } })
  }
  const continueWriting = () => {
    void navigate({
      to: '/timelines/$id',
      params: { id: story.timelineId },
      search: { view: 'stories', story: story.storyId },
    })
  }
  const share = async () => {
    capture('home_share_clicked', { project_id: projectId ?? undefined, story_id: story.storyId, source: 'hero' })
    try {
      const res = await publishStoryShare({ data: story.storyId })
      if ('error' in res) {
        toast.error('Could not share this story.')
        return
      }
      const url = `${window.location.origin}/s/${res.slug}`
      capture('story_shared', { story_id: story.storyId })
      if (navigator.share) {
        await navigator.share({ url, title: 'Read this story on Synek' }).catch(() => {})
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Public link copied — anyone can read it', { description: url })
      }
    } catch {
      toast.error('Could not share this story.')
    }
  }

  const castNames = story.castNames ?? []
  const visibleCast = castNames.slice(0, MAX_CAST)
  const extraCast = castNames.length - visibleCast.length

  return (
    <section className="ch-hero" data-wash={cover ? undefined : true} aria-label="Featured story">
      {cover && (
        <img
          key={cover.url}
          className="ch-hero-img"
          src={cover.url}
          alt={cover.alt ?? ''}
          // The cover changes on project switch — re-keying drives the fade-in.
        />
      )}
      <div className="ch-hero-scrim" aria-hidden="true" />
      <div className="ch-hero-body">
        <p className="ch-hero-eyebrow">
          {projectName && <span>{projectName}</span>}
          {projectName && (
            <span className="ch-sep" aria-hidden="true">
              ·
            </span>
          )}
          <span>{story.timelineTitle}</span>
        </p>
        <h1 className="ch-hero-title">{story.title}</h1>
        {story.hook && <p className="ch-hero-hook">{story.hook}</p>}
        {visibleCast.length > 0 && (
          <div className="ch-hero-cast" aria-label="Cast">
            {visibleCast.map((name, i) => (
              <span key={i} className="ch-hero-castchip">
                {name}
              </span>
            ))}
            {extraCast > 0 && <span className="ch-hero-castchip">+{extraCast} more</span>}
          </div>
        )}
        <p className="ch-hero-meta">
          {story.beatCount} {story.beatCount === 1 ? 'beat' : 'beats'}
          {story.estimatedMinutes != null && <> · ~{story.estimatedMinutes} min read</>}
        </p>
        <div className="ch-hero-actions">
          <button type="button" className="ch-play" onClick={play}>
            <Play aria-hidden="true" />
            Play story
          </button>
          <button type="button" className="ch-secondary" onClick={continueWriting}>
            <Pencil aria-hidden="true" />
            Continue writing
          </button>
          <button type="button" className="ch-secondary" onClick={() => void share()}>
            <Share2 aria-hidden="true" />
            Share
          </button>
        </div>
      </div>
    </section>
  )
}

function EmptyHero({
  variant,
  projectName,
  hasApiKey,
  onNewTimeline,
  firstTimeline,
  timelineCount,
}: Extract<HeroProps, { kind: 'empty' }>) {
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
            <Link
              to="/timelines/$id"
              params={{ id: firstTimeline.id }}
              className="ch-play"
            >
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
