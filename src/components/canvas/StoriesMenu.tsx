import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronDown, Play, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { listStories } from '~/lib/server/stories'
import { POV_LABEL } from '~/lib/domain/story-labels'
import { NewStoryDialog } from './NewStoryDialog'
import { floatChip } from './chrome'

// Toolbar "Stories" control: a popover panel listing every story on the timeline as
// a preview card (title, hook, the moment it sits on, depth, beat count), plus a
// "New Story" action. Picking a card opens that story's cover in the docked reader
// (the canvas decides what the reader plays — see TimelineCanvas). This replaces the
// Stories ViewSwitcher lens — stories live in their own panel again, not a full-pane
// view that swaps out the canvas.
//
// Freshness rides the graph's `storyVersion` signature (folded into the query key),
// so a story written from any source — including the separate-process stdio MCP
// server — refreshes this list within the canvas's poll, no extra invalidation.
export function StoriesMenu({
  timelineId,
  storyVersion,
  canCreate,
  nodes,
  openStoryId,
  onOpenStory,
}: {
  timelineId: string
  storyVersion: string
  // Owners can create a new story (the picker + copy-prompt dialog); viewers can't.
  canCreate: boolean
  // Moments to offer in the "New Story" picker.
  nodes: { id: string; title: string; type: string }[]
  // The story currently open in the reader (highlights its card), or null.
  openStoryId: string | null
  // Open a story's cover in the docked reader.
  onOpenStory: (storyId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories-list', timelineId, storyVersion],
    queryFn: () => listStories({ data: timelineId }),
  })
  const count = stories?.length ?? 0

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn(floatChip, 'h-8')} title="Stories on this timeline">
            <BookOpen />
            Stories
            {count > 0 && <span className="stories-count">{count}</span>}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="stories-menu max-w-[calc(100vw-24px)] overflow-hidden p-0">
          <header className="stories-menu-header">
            <span className="stories-menu-title">Stories</span>
            {canCreate && (
              <button
                type="button"
                className="stories-new-btn"
                onClick={() => {
                  setOpen(false)
                  setNewOpen(true)
                }}
              >
                <Plus size={14} aria-hidden="true" />
                New Story
              </button>
            )}
          </header>
          <div className="stories-menu-body">
            {isLoading ? (
              <ul className="stories-list" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <li key={i}>
                    <div className="story-list-card is-skeleton" />
                  </li>
                ))}
              </ul>
            ) : count === 0 ? (
              <div className="stories-menu-empty">
                <BookOpen className="stories-empty-icon" aria-hidden="true" />
                <p className="stories-empty-body">
                  {canCreate
                    ? 'No stories yet. Build your timeline, then start a story — your connected Claude narrates a moment and it appears here.'
                    : 'The author hasn’t written any stories on this timeline yet.'}
                </p>
              </div>
            ) : (
              <ul className="stories-list" role="list">
                {stories!.map((s) => (
                  <li key={s.storyId}>
                    <button
                      type="button"
                      className="story-list-card"
                      data-open={s.storyId === openStoryId || undefined}
                      onClick={() => {
                        setOpen(false)
                        onOpenStory(s.storyId)
                      }}
                      aria-label={`Open “${s.title}” — ${s.beatCount} ${s.beatCount === 1 ? 'beat' : 'beats'}, on ${s.momentTitle}`}
                      title={`Open “${s.title}”`}
                    >
                      {s.coverImage && (
                        <span className="story-card-thumb" aria-hidden="true">
                          <img src={s.coverImage.url} alt="" loading="lazy" />
                        </span>
                      )}
                      <span className="story-card-body">
                        <span className="story-card-titlerow">
                          <span className="story-card-title">{s.title}</span>
                          {s.depthTier === 'deep' && <span className="story-card-tier">Deep</span>}
                        </span>
                        {s.hook && <span className="story-card-hook">{s.hook}</span>}
                        <span className="story-card-meta">
                          <span className="story-card-moment">{s.momentTitle}</span>
                          {s.povType !== 'omniscient' && <span className="story-card-chip">{POV_LABEL[s.povType]}</span>}
                          <span className="story-card-chip">
                            {s.beatCount} {s.beatCount === 1 ? 'beat' : 'beats'}
                          </span>
                          {s.estimatedMinutes != null && (
                            <span className="story-card-chip">~{s.estimatedMinutes} min</span>
                          )}
                          <span className="story-card-play">
                            <Play size={13} aria-hidden="true" />
                            Read
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {canCreate && (
        <NewStoryDialog open={newOpen} onOpenChange={setNewOpen} timelineId={timelineId} nodes={nodes} />
      )}
    </>
  )
}
