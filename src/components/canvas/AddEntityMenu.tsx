import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Search } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { searchEntities, placeEntityOnTimeline } from '~/lib/server/entities'
import { floatChip } from './chrome'

// Toolbar "Add entity" control (ADR 0004): search the owner's existing entities and
// PLACE one onto this timeline as a new placement. The same canonical entity can
// live on many timelines — editing it anywhere propagates to all of them. The
// picker excludes entities already on this timeline (no duplicate placements).
export function AddEntityMenu({ timelineId }: { timelineId: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: hits, isFetching } = useQuery({
    queryKey: ['entity-search', timelineId, q],
    queryFn: () => searchEntities({ data: { q, excludeTimelineId: timelineId } }),
    enabled: open,
  })

  async function place(entityId: string) {
    if (busy) return
    setBusy(entityId)
    try {
      await placeEntityOnTimeline({ data: { timelineId, entityId } })
      await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      setOpen(false)
      setQ('')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(floatChip, 'h-8')}
          title="Add an existing entity to this timeline"
          data-testid="add-entity"
        >
          <Plus />
          Add entity
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="add-entity-menu max-w-[calc(100vw-24px)] p-0">
        <div className="add-entity-search">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your entities…"
            aria-label="Search your entities"
            autoFocus
          />
        </div>
        <ul className="add-entity-list" role="list">
          {hits && hits.length > 0 ? (
            hits.map((h) => (
              <li key={h.entityId}>
                <button
                  type="button"
                  className="add-entity-row"
                  disabled={busy === h.entityId}
                  onClick={() => place(h.entityId)}
                >
                  <span className="add-entity-row-head">
                    <span className="add-entity-row-title">{h.title}</span>
                    <span className="add-entity-row-type">{h.type}</span>
                    {busy === h.entityId && <Loader2 className="size-3.5 animate-spin" />}
                  </span>
                  {h.summary && <span className="add-entity-row-summary">{h.summary}</span>}
                </button>
              </li>
            ))
          ) : (
            <li className="add-entity-empty">
              {isFetching ? 'Searching…' : q ? 'No matching entities' : 'Type to search your entities'}
            </li>
          )}
        </ul>
        <p className="add-entity-hint">
          Places an existing entity here. Editing it on any timeline updates every timeline it appears on.
        </p>
      </PopoverContent>
    </Popover>
  )
}
