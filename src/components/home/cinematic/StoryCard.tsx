import { useState } from 'react'
import { BookOpen, LayoutGrid, MoreHorizontal, Pencil, Play, Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import type { HomeStoryCard, ProjectSummary } from '~/lib/domain/types'
import { MoveToProjectSubmenu } from './MoveToProjectSubmenu'
import { useMoveTimeline } from './useMoveTimeline'
import { useStoryActions } from './useStoryActions'
import { StoryIntroDialog } from './StoryIntroDialog'
import { hueFromString } from './hue'

// One story in a home carousel row — a vertical poster (portrait cover + body).
// Clicking the card body opens the story's INTRO dialog (its cover page); the
// footer Play jumps straight into the in-app reader and autostarts (?autoplay).
// The overflow menu carries Open canvas / Continue writing / Share / Move to project.
export function StoryCard({
  story,
  projects,
  // The project this story's timeline currently belongs to (for the move submenu's
  // "current" marker + the undo path). null when unknown (legacy null-project).
  currentProjectId,
}: {
  story: HomeStoryCard
  projects: ProjectSummary[]
  currentProjectId: string | null
}) {
  const [introOpen, setIntroOpen] = useState(false)
  const move = useMoveTimeline()
  const { play, continueWriting, openCanvas, share } = useStoryActions(
    story,
    currentProjectId,
    'card',
  )

  const minutes = story.estimatedMinutes
  const showMove = projects.length > 1

  return (
    <article className="ch-card">
      <button
        type="button"
        className="ch-card-open"
        onClick={() => setIntroOpen(true)}
        aria-label={`Open “${story.title}”`}
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

      <StoryIntroDialog
        story={story}
        projectId={currentProjectId}
        open={introOpen}
        onOpenChange={setIntroOpen}
      />
    </article>
  )
}
