import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, BookOpen, ChevronDown, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { listStories } from '~/lib/server/stories'
import type { StoryListItem } from '~/lib/domain/types'
import { NewStoryDialog } from './NewStoryDialog'
import { floatChip } from './chrome'

// Sort is a UI preference (per device, never graph state), so it lives in
// localStorage beside the other canvas prefs.
const SORT_KEY = 'synek:stories-sort'
type StorySort = 'newest' | 'timeline' | 'title'
const SORT_LABEL: Record<StorySort, string> = {
  newest: 'Newest',
  timeline: 'Timeline order',
  title: 'Title',
}

// The DB returns rows in TIMELINE order (the moment's date on the axis), which is
// the right default for reading a finished timeline and the wrong one for a series
// you are actively writing — the chapter you just wrote can land in the middle.
// Default to newest-written; 'timeline' keeps the old behaviour available.
function sortStories(rows: StoryListItem[], sort: StorySort): StoryListItem[] {
  const out = [...rows]
  if (sort === 'newest') return out.sort((a, b) => b.createdAt - a.createdAt)
  if (sort === 'title') return out.sort((a, b) => a.title.localeCompare(b.title))
  return out // server order is already timeline order
}

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
  const [sort, setSort] = useState<StorySort>(() => {
    if (typeof window === 'undefined') return 'newest'
    const saved = window.localStorage.getItem(SORT_KEY)
    return saved === 'timeline' || saved === 'title' ? saved : 'newest'
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_KEY, sort)
    } catch {
      // ignore quota / disabled storage
    }
  }, [sort])
  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories-list', timelineId, storyVersion],
    queryFn: () => listStories({ data: timelineId }),
  })
  const count = stories?.length ?? 0
  const sorted = useMemo(() => sortStories(stories ?? [], sort), [stories, sort])

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn(floatChip, 'h-8')} title="Stories on this timeline">
            <BookOpen />
            <span className="cq-hide-narrow">Stories</span>
            {count > 0 && <span className="stories-count">{count}</span>}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="stories-menu max-w-[calc(100vw-24px)] overflow-hidden p-0">
          <header className="stories-menu-header">
            <span className="stories-menu-title">Stories</span>
            {count > 1 && (
              <label className="stories-sort">
                <ArrowUpDown size={13} aria-hidden="true" />
                <span className="sr-only">Sort stories by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as StorySort)}>
                  {(Object.keys(SORT_LABEL) as StorySort[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                {sorted.map((s) => (
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
                    >
                      {/* Minimal by design: a title line and one meta line. The hook,
                          the cover thumbnail, the POV chip and the "Read" pill are all
                          in the reader a click away, and four of them per row turned a
                          list of ten stories into a wall. */}
                      <span className="story-card-titlerow">
                        {s.chapterNumber != null && <span className="story-card-ch">{s.chapterNumber}</span>}
                        <span className="story-card-title">{s.title}</span>
                      </span>
                      <span className="story-card-meta">
                        <span className="story-card-moment">{s.momentTitle}</span>
                        <span aria-hidden="true">·</span>
                        <span>{s.beatCount}</span>
                        {s.estimatedMinutes != null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{s.estimatedMinutes}m</span>
                          </>
                        )}
                        {s.depthTier === 'deep' && <span className="story-card-deep">Deep</span>}
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
