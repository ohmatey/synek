import { useNavigate } from '@tanstack/react-router'
import { BookOpen, LayoutGrid, MoreHorizontal, Pencil, Play, Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { publishStoryShare } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'
import { toast } from 'sonner'
import type { HomeStoryCard, ProjectSummary } from '~/lib/domain/types'
import { MoveToProjectSubmenu } from './MoveToProjectSubmenu'
import { useMoveTimeline } from './useMoveTimeline'

// One story in a home carousel row (Wren §5 card anatomy). The card body + Play
// open the in-app reader (/timelines/$id?story=$storyId); the overflow menu carries
// Open canvas / Continue writing / Share / Move to project. Reuses the story-soft
// cover fallback tint when a story has no cover.
export function StoryCard({
  story,
  projects,
  // The project this story's timeline currently belongs to (for the move submenu's
  // "current" marker + the undo path). Resolved by the parent from the rail filter
  // or a per-timeline lookup; null when unknown (legacy null-project timeline).
  currentProjectId,
}: {
  story: HomeStoryCard
  projects: ProjectSummary[]
  currentProjectId: string | null
}) {
  const navigate = useNavigate()
  const move = useMoveTimeline()

  // Play → the reader flow; Continue writing → the creator (stories-lens) flow.
  const play = () => {
    capture('home_story_card_clicked', { project_id: currentProjectId ?? undefined, story_id: story.storyId })
    void navigate({ to: '/timelines/$id', params: { id: story.timelineId }, search: { story: story.storyId } })
  }
  const continueWriting = () => {
    void navigate({
      to: '/timelines/$id',
      params: { id: story.timelineId },
      search: { view: 'stories', story: story.storyId },
    })
  }
  const openCanvas = () => {
    void navigate({ to: '/timelines/$id', params: { id: story.timelineId } })
  }
  const share = async () => {
    capture('home_share_clicked', {
      project_id: currentProjectId ?? undefined,
      story_id: story.storyId,
      source: 'card',
    })
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

  const minutes = story.estimatedMinutes
  const showMove = projects.length > 1

  return (
    <article className="ch-card">
      <button type="button" className="ch-card-open" onClick={play} aria-label={`Play “${story.title}”`}>
        <span className="ch-card-cover">
          {story.coverImage ? (
            <img src={story.coverImage.url} alt={story.coverImage.alt ?? ''} loading="lazy" />
          ) : (
            <span className="ch-card-cover-fallback" aria-hidden="true">
              <BookOpen />
            </span>
          )}
        </span>
        <span className="ch-card-body">
          <span className="ch-card-title">{story.title}</span>
          {story.hook && <span className="ch-card-hook">{story.hook}</span>}
          <span className="ch-card-meta">
            <span>
              {story.beatCount} {story.beatCount === 1 ? 'beat' : 'beats'}
            </span>
            {minutes != null && (
              <>
                <span className="ch-card-dot" aria-hidden="true">
                  ·
                </span>
                <span>~{minutes} min</span>
              </>
            )}
          </span>
        </span>
      </button>
      <div className="ch-card-foot">
        <button type="button" className="ch-card-play" onClick={play}>
          <Play aria-hidden="true" />
          Play
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent"
              aria-label={`Actions for “${story.title}”`}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={openCanvas}>
              <LayoutGrid />
              Open canvas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={continueWriting}>
              <Pencil />
              Continue writing
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void share()}>
              <Share2 />
              Share
            </DropdownMenuItem>
            {showMove && (
              <>
                <DropdownMenuSeparator />
                <MoveToProjectSubmenu
                  projects={projects}
                  currentProjectId={currentProjectId}
                  onMove={(target) =>
                    void move({
                      timelineId: story.timelineId,
                      fromProjectId: currentProjectId,
                      targetProjectId: target.id,
                      targetProjectTitle: target.title,
                      itemLabel: story.title,
                    })
                  }
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
