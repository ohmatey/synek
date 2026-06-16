import { useEffect, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Pencil, Play, Share2 } from 'lucide-react'
import type { HomeStoryCard } from '~/lib/domain/types'
import { useStoryActions } from './useStoryActions'
import { StoryIntroDialog } from './StoryIntroDialog'
import { hueFromString } from './hue'

const MAX_CAST = 4

// The featured-story unit (ask #5): a CONTAINED panel (no full-bleed page
// background) that spotlights one story and lets you page through the most-recent
// stories with ‹ / › — "recently viewed" isn't tracked, so this is recency by
// updatedAt (the list is already sorted newest-first by the server fn). Play jumps
// into the reader + autostarts; clicking the poster opens the intro dialog.
export function FeaturedStory({
  stories,
  projectName,
  projectId,
}: {
  // Non-empty, newest-updated first (the caller guarantees length > 0).
  stories: HomeStoryCard[]
  projectName: string | null
  projectId: string | null
}) {
  const [index, setIndex] = useState(0)
  const [introOpen, setIntroOpen] = useState(false)

  // The story set can shrink/grow on poll or project switch — keep index in range.
  useEffect(() => {
    if (index > stories.length - 1) setIndex(0)
  }, [stories.length, index])

  const safe = Math.min(index, stories.length - 1)
  const story = stories[safe]
  const many = stories.length > 1
  const { play, continueWriting, share } = useStoryActions(story, projectId, 'featured')

  const cover = story.coverImage
  const cast = (story.castNames ?? []).slice(0, MAX_CAST)
  const extra = (story.castNames ?? []).length - cast.length

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + stories.length) % stories.length)

  return (
    <section className="ch-featured" aria-label="Featured story" aria-roledescription="carousel">
      {many && (
        <button
          type="button"
          className="ch-featured-nav ch-featured-prev"
          onClick={() => go(-1)}
          aria-label="Previous story"
        >
          <ChevronLeft />
        </button>
      )}

      <div className="ch-featured-panel">
        <button
          type="button"
          className="ch-featured-poster"
          data-wash={cover ? undefined : true}
          onClick={() => setIntroOpen(true)}
          aria-label={`Open “${story.title}”`}
          style={cover ? undefined : ({ '--cover-hue': hueFromString(story.storyId) } as React.CSSProperties)}
        >
          {cover ? (
            <img key={cover.url} src={cover.url} alt={cover.alt ?? ''} />
          ) : (
            <span className="ch-featured-poster-fallback" aria-hidden="true">
              <BookOpen />
            </span>
          )}
        </button>

        <div className="ch-featured-body">
          <p className="ch-featured-eyebrow">
            {projectName && <span>{projectName}</span>}
            {projectName && (
              <span className="ch-sep" aria-hidden="true">
                ·
              </span>
            )}
            <span>{story.timelineTitle}</span>
          </p>
          <h2 className="ch-featured-title">{story.title}</h2>
          {story.hook && <p className="ch-featured-hook">{story.hook}</p>}
          {cast.length > 0 && (
            <div className="ch-featured-cast" aria-label="Cast">
              {cast.map((name, i) => (
                <span key={i} className="ch-featured-castchip">
                  {name}
                </span>
              ))}
              {extra > 0 && <span className="ch-featured-castchip">+{extra} more</span>}
            </div>
          )}
          <p className="ch-featured-meta">
            {story.beatCount} {story.beatCount === 1 ? 'beat' : 'beats'}
            {story.estimatedMinutes != null && <> · ~{story.estimatedMinutes} min read</>}
          </p>
          <div className="ch-featured-actions">
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
          {many && (
            <div className="ch-featured-dots" role="tablist" aria-label="Featured stories">
              {stories.map((s, i) => (
                <button
                  key={s.storyId}
                  type="button"
                  role="tab"
                  aria-selected={i === safe}
                  aria-label={`Show “${s.title}”`}
                  className="ch-featured-dot"
                  data-active={i === safe ? true : undefined}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {many && (
        <button
          type="button"
          className="ch-featured-nav ch-featured-next"
          onClick={() => go(1)}
          aria-label="Next story"
        >
          <ChevronRight />
        </button>
      )}

      <StoryIntroDialog
        story={story}
        projectId={projectId}
        open={introOpen}
        onOpenChange={setIntroOpen}
      />
    </section>
  )
}
