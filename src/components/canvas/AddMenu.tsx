import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Building2,
  Layers,
  Lightbulb,
  Loader2,
  Plus,
  Search,
  Sparkles,
  User,
  Zap,
} from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/utils'
import { searchEntities, placeEntityOnTimeline } from '~/lib/server/entities'
import { createNode } from '~/lib/server/nodes'
import { formatInstant, parseDate } from '~/lib/domain/dates'
import { NODE_TYPES, NODE_SUBTYPES, type NodeSubtype, type NodeType } from '~/lib/domain/types'
import { NewStoryDialog } from './NewStoryDialog'
import { floatChip } from './chrome'

// The three flows behind the unified "Add" entry point. `null` = nothing open.
// The mode lives in TimelineCanvas so BOTH the toolbar button and ⌘K can drive the
// same dialogs (a single set of controlled dialogs; see AddDialogs).
export type AddMode = 'create' | 'place' | 'story' | null

// Toolbar "Add" button → a small menu of the three add flows. Owner-only; dumb —
// it only reports which flow to open. The dialogs render once in TimelineCanvas.
export function AddMenu({ onPick }: { onPick: (mode: Exclude<AddMode, null>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(floatChip, 'h-8')}
          title="Add to this timeline"
          data-testid="add-menu"
        >
          <Plus />
          <span className="cq-hide-narrow">Add</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onPick('create')}>
          <Sparkles />
          Create new…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('place')}>
          <Search />
          Place existing entity…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('story')}>
          <BookOpen />
          New story…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// All three add dialogs, controlled by a single `mode`. Rendered once by
// TimelineCanvas so the toolbar Add button and ⌘K share them.
export function AddDialogs({
  mode,
  onMode,
  timelineId,
  nodes,
  onCreated,
}: {
  mode: AddMode
  onMode: (m: AddMode) => void
  timelineId: string
  nodes: { id: string; title: string; type: string }[]
  onCreated?: (nodeId: string) => void
}) {
  return (
    <>
      <CreateNodeDialog
        open={mode === 'create'}
        onOpenChange={(o) => onMode(o ? 'create' : null)}
        timelineId={timelineId}
        onCreated={onCreated}
      />
      <PlaceEntityDialog
        open={mode === 'place'}
        onOpenChange={(o) => onMode(o ? 'place' : null)}
        timelineId={timelineId}
      />
      <NewStoryDialog
        open={mode === 'story'}
        onOpenChange={(o) => onMode(o ? 'story' : null)}
        timelineId={timelineId}
        nodes={nodes}
      />
    </>
  )
}

const TYPE_META: Record<NodeType, { label: string; icon: typeof Zap }> = {
  event: { label: 'Event', icon: Zap },
  entity: { label: 'Entity', icon: User },
  period: { label: 'Period', icon: Layers },
  concept: { label: 'Concept', icon: Lightbulb },
}

// The in-app authoring form. Minimal on purpose (type, title, date, optional
// end/summary/track/kind) — richer fields (images, citations, coordinates) stay in
// the node detail panel or come from the connected Claude. Submits to createNode,
// which commits one undoable Patch; the canvas refreshes on graph invalidation.
function CreateNodeDialog({
  open,
  onOpenChange,
  timelineId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  timelineId: string
  onCreated?: (nodeId: string) => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<NodeType>('event')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [summary, setSummary] = useState('')
  const [lane, setLane] = useState('')
  const [subtype, setSubtype] = useState<NodeSubtype | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Periods and entities carry a span; events/concepts are a single instant.
  const hasSpan = type === 'period' || type === 'entity'
  const preview = date.trim()
    ? (() => {
        const p = parseDate(date)
        return formatInstant(p.instant, p.precision)
      })()
    : null

  function reset() {
    setType('event')
    setTitle('')
    setDate('')
    setEndDate('')
    setSummary('')
    setLane('')
    setSubtype('')
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!title.trim()) return setError('Add a title.')
    if (!date.trim()) return setError('Add a date.')
    setBusy(true)
    setError(null)
    try {
      const res = await createNode({
        data: {
          timelineId,
          type,
          title: title.trim(),
          date: date.trim(),
          endDate: hasSpan && endDate.trim() ? endDate.trim() : undefined,
          summary: summary.trim() || undefined,
          lane: lane.trim() || undefined,
          subtype: type === 'entity' && subtype ? subtype : undefined,
        },
      })
      if (!res.ok) {
        setError(res.error ?? 'Could not add.')
        return
      }
      await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      onCreated?.(res.nodeId)
      reset()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to timeline</DialogTitle>
          <DialogDescription>Create a new node directly on this timeline.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-1.5">
            {NODE_TYPES.map((t) => {
              const M = TYPE_META[t]
              const Icon = M.icon
              const active = type === t
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {M.label}
                </button>
              )
            })}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Apollo 11 Moon landing"
              autoFocus
            />
          </label>

          <div className={cn('grid gap-3', hasSpan ? 'grid-cols-2' : 'grid-cols-1')}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{hasSpan ? 'Start' : 'Date'}</span>
              <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="1969-07-20 · Q3 2008 · 49 BCE" />
            </label>
            {hasSpan && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  End <span className="text-muted-foreground">(optional)</span>
                </span>
                <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="ongoing if blank" />
              </label>
            )}
          </div>
          {preview && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Reads as <span className="text-foreground">{preview}</span>
            </p>
          )}

          {type === 'entity' && (
            <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
              {NODE_SUBTYPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={subtype === s}
                  onClick={() => setSubtype(subtype === s ? '' : s)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs capitalize transition-colors',
                    subtype === s
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Summary <span className="text-muted-foreground">(optional)</span>
            </span>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="One or two lines of context."
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Track <span className="text-muted-foreground">(optional)</span>
            </span>
            <Input value={lane} onChange={(e) => setLane(e.target.value)} placeholder="e.g. NASA" />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Add to timeline
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Place an EXISTING entity (ADR 0004) — the old AddEntityMenu, rehomed as a dialog
// branch of the unified Add surface. Search the owner's entities, click to place.
function PlaceEntityDialog({
  open,
  onOpenChange,
  timelineId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  timelineId: string
}) {
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
      setQ('')
      onOpenChange(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQ('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Place existing entity</DialogTitle>
          <DialogDescription>
            Add an entity you already have. Editing it on any timeline updates every timeline it appears on.
          </DialogDescription>
        </DialogHeader>
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            name="entitySearch"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your entities…"
            aria-label="Search your entities"
            autoFocus
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-auto" role="list">
          {hits && hits.length > 0 ? (
            hits.map((h) => (
              <li key={h.entityId}>
                <button
                  type="button"
                  disabled={busy === h.entityId}
                  onClick={() => place(h.entityId)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{h.type}</span>
                    {busy === h.entityId && <Loader2 className="size-3.5 animate-spin" />}
                  </span>
                  {h.summary && <span className="line-clamp-1 text-xs text-muted-foreground">{h.summary}</span>}
                </button>
              </li>
            ))
          ) : (
            <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {isFetching ? 'Searching…' : q ? 'No matching entities' : 'Type to search your entities'}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
