import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronDown, Play } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { listStories } from '~/lib/server/stories'
import { floatChip } from './chrome'

// AppBar "Stories" control: a popover listing every story on the timeline as a
// preview card (title, hook, the moment it sits on, depth, beat count), in
// chronological moment order. Picking a card opens its moment and plays it in the
// Reels/Stories viewer.
//
// Freshness rides the graph's `storyVersion` signature (folded into the query key),
// so a story written from any source — including the separate-process stdio MCP
// server — refreshes this list within the canvas's poll, no extra invalidation.
export function StoriesMenu({
  timelineId,
  storyVersion,
  onPlay,
}: {
  timelineId: string
  storyVersion: string
  onPlay: (momentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: stories } = useQuery({
    queryKey: ['stories-list', timelineId, storyVersion],
    queryFn: () => listStories({ data: timelineId }),
  })
  const count = stories?.length ?? 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(floatChip, 'h-8')} title="Stories on this timeline">
          <BookOpen />
          Stories
          {count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{count}</span>}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-24px)] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-medium">Stories</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        {count === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No stories yet.</div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto p-2">
            {stories!.map((s) => (
              <button
                key={s.storyId}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPlay(s.momentId)
                }}
                className="group flex flex-col gap-1.5 rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:border-foreground/20 focus-visible:bg-accent/50 focus-visible:outline-none"
                title={`Play “${s.title}”`}
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1 text-sm font-semibold leading-snug">{s.title}</span>
                  {s.depthTier === 'deep' && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: 'var(--color-story-soft)', color: 'var(--color-accent-story)' }}
                    >
                      Deep
                    </span>
                  )}
                </div>
                {s.hook && (
                  <p className="line-clamp-2 text-xs italic leading-relaxed text-muted-foreground">{s.hook}</p>
                )}
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{s.momentTitle}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {s.beatCount} {s.beatCount === 1 ? 'beat' : 'beats'}
                  </span>
                  <span
                    className="ml-1 inline-flex shrink-0 items-center gap-1 font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    style={{ color: 'var(--color-accent-story)' }}
                  >
                    <Play className="size-3.5" />
                    Play
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
