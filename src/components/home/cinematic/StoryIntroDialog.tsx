import { BookOpen, Pencil, Play, Share2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog'
import type { HomeStoryCard } from '~/lib/domain/types'
import { useStoryActions } from './useStoryActions'

const MAX_CAST = 6

// The story "intro page" as a modal (the cover the reader used to show): poster,
// title, hook, cast, length — and the primary actions. Opened by clicking a story
// card (or the featured panel body). "Play story" leaves for the in-app reader and
// autostarts there (useStoryActions.play → ?autoplay), so the cover isn't shown twice.
export function StoryIntroDialog({
  story,
  projectId,
  open,
  onOpenChange,
}: {
  story: HomeStoryCard | null
  projectId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton>
        {story && <IntroBody story={story} projectId={projectId} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

function IntroBody({
  story,
  projectId,
  onOpenChange,
}: {
  story: HomeStoryCard
  projectId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { play, continueWriting, share } = useStoryActions(story, projectId, 'intro-dialog')
  const cast = (story.castNames ?? []).slice(0, MAX_CAST)
  const extra = (story.castNames ?? []).length - cast.length

  return (
    <div className="ch-intro">
      <div className="ch-intro-cover" data-wash={story.coverImage ? undefined : true}>
        {story.coverImage ? (
          <img src={story.coverImage.url} alt={story.coverImage.alt ?? ''} />
        ) : (
          <span className="ch-intro-cover-fallback" aria-hidden="true">
            <BookOpen />
          </span>
        )}
      </div>
      <div className="ch-intro-body">
        <p className="ch-intro-eyebrow">{story.timelineTitle}</p>
        <DialogTitle className="ch-intro-title">{story.title}</DialogTitle>
        {story.hook ? (
          <DialogDescription className="ch-intro-hook">{story.hook}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">Story intro for {story.title}</DialogDescription>
        )}
        {cast.length > 0 && (
          <div className="ch-intro-cast" aria-label="Cast">
            {cast.map((name, i) => (
              <span key={i} className="ch-intro-castchip">
                {name}
              </span>
            ))}
            {extra > 0 && <span className="ch-intro-castchip">+{extra} more</span>}
          </div>
        )}
        <p className="ch-intro-meta">
          {story.beatCount} {story.beatCount === 1 ? 'beat' : 'beats'}
          {story.estimatedMinutes != null && <> · ~{story.estimatedMinutes} min read</>}
        </p>
        <div className="ch-intro-actions">
          <button type="button" className="ch-play" onClick={play}>
            <Play aria-hidden="true" />
            Play story
          </button>
          <button
            type="button"
            className="ch-secondary"
            onClick={() => {
              onOpenChange(false)
              continueWriting()
            }}
          >
            <Pencil aria-hidden="true" />
            Continue writing
          </button>
          <button type="button" className="ch-secondary" onClick={() => void share()}>
            <Share2 aria-hidden="true" />
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
