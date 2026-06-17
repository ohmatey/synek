import { Link } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'
import type { PublicStoryCard as PublicStoryCardDTO } from '~/lib/domain/types'
import { hueFromString } from '~/components/home/cinematic/hue'

// One public story in the Explore "Stories" row — a vertical poster that links
// straight to its sharable reader at /s/$slug (no owner actions, unlike the
// home's StoryCard). Reuses the cinematic .ch-card atoms for a consistent look.
export function PublicStoryCard({ story }: { story: PublicStoryCardDTO }) {
  const minutes = story.estimatedMinutes
  return (
    <article className="ch-card">
      <Link
        to="/s/$slug"
        params={{ slug: story.slug }}
        className="ch-card-open"
        aria-label={`Read “${story.title}”`}
      >
        <span
          className="ch-card-cover"
          data-wash={story.coverImage ? undefined : true}
          style={
            story.coverImage ? undefined : ({ '--cover-hue': hueFromString(story.storyId) } as React.CSSProperties)
          }
        >
          {story.coverImage ? (
            <img src={story.coverImage.url} alt={story.coverImage.alt ?? ''} loading="lazy" />
          ) : (
            <span className="ch-card-cover-fallback" aria-hidden="true">
              <BookOpen />
            </span>
          )}
        </span>
        <span className="ch-card-body">
          <span className="ch-card-eyebrow">{story.timelineTitle}</span>
          <span className="ch-card-title">{story.title}</span>
          {story.hook && <span className="ch-card-hook">{story.hook}</span>}
          {minutes != null && (
            <span className="ch-card-meta">
              <span>~{minutes} min</span>
            </span>
          )}
        </span>
      </Link>
    </article>
  )
}
