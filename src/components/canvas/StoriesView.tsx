import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Play, Plus } from 'lucide-react'
import { cn } from '~/lib/utils'
import { listStories } from '~/lib/server/stories'
import { POV_LABEL } from '~/lib/domain/story-labels'
import { NewStoryDialog } from './NewStoryDialog'

// The "Stories" lens (a sibling of the timeline + globe views): a browsable list of
// every story on the timeline, plus an empty state that hands the user a copy-prompt
// to write their first one. Picking a card opens that story's cover in the docked
// reader (the canvas decides what the reader plays — see TimelineCanvas). This
// REPLACES the old AppBar Stories popover (StoriesMenu).
//
// Freshness rides the graph's `storyVersion` signature (folded into the query key),
// so a story written from any source — including the separate-process stdio MCP
// server — refreshes this list within the canvas's poll, no extra invalidation.
export function StoriesView({
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
  const [newOpen, setNewOpen] = useState(false)
  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories-list', timelineId, storyVersion],
    queryFn: () => listStories({ data: timelineId }),
  })
  const count = stories?.length ?? 0

  return (
    <section className="stories-view" aria-label="Stories">
      {isLoading ? (
        <ul className="stories-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="story-list-card is-skeleton" />
            </li>
          ))}
        </ul>
      ) : count === 0 ? (
        <div className="stories-empty">
          <BookOpen className="stories-empty-icon" aria-hidden="true" />
          <h2 className="stories-empty-title">No stories yet</h2>
          {canCreate ? (
            <>
              <p className="stories-empty-body">
                Stories are written by your connected Claude. Build your timeline first, then paste a prompt and Claude
                narrates a moment — it appears here, ready to read.
              </p>
              <button type="button" className="stories-empty-cta" onClick={() => setNewOpen(true)}>
                <Plus size={15} aria-hidden="true" />
                New Story
              </button>
            </>
          ) : (
            <p className="stories-empty-body">The author hasn’t written any stories on this timeline yet.</p>
          )}
        </div>
      ) : (
        <>
          <header className="stories-header">
            <h2 className="stories-header-title">
              Stories <span className="stories-count">{count}</span>
            </h2>
            {canCreate && (
              <button type="button" className="stories-new-btn" onClick={() => setNewOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                New Story
              </button>
            )}
          </header>
          <ul className="stories-list" role="list">
            {stories!.map((s) => (
              <li key={s.storyId}>
                <button
                  type="button"
                  className="story-list-card"
                  data-open={s.storyId === openStoryId || undefined}
                  onClick={() => onOpenStory(s.storyId)}
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
                      {s.estimatedMinutes != null && <span className="story-card-chip">~{s.estimatedMinutes} min</span>}
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
        </>
      )}
      {canCreate && (
        <NewStoryDialog open={newOpen} onOpenChange={setNewOpen} timelineId={timelineId} nodes={nodes} />
      )}
    </section>
  )
}
