import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  ListFilter,
  Plus,
  Rows3,
  Search,
} from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { deleteTimeline, listTimelines, renameTimeline } from '~/lib/server/timelines'
import type { TimelineSummary } from '~/lib/domain/types'
import { cn } from '~/lib/utils'
import { NewTimelineDialog } from './NewTimelineDialog'
import { RowMenu } from './RowMenu'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const PAGE_SIZE = 9

type ViewMode = 'cards' | 'rows'
type Filter = 'all' | 'public' | 'private'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  public: 'Public',
  private: 'Private',
}

// Shared "linear-gradient surface" look — matches the card treatment so the
// segmented controls read as the same material as the cards below them.
const segmentSurface =
  'rounded-lg border border-border/60 bg-card/80 bg-gradient-to-b from-foreground/[0.04] to-transparent shadow-sm'

export function TimelinesSection() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: timelines = [] } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('cards')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  // Remember the user's last view preference across visits.
  useEffect(() => {
    const saved = window.localStorage.getItem('synek:timelines-view')
    if (saved === 'cards' || saved === 'rows') setView(saved)
  }, [])
  const pickView = (v: ViewMode) => {
    setView(v)
    window.localStorage.setItem('synek:timelines-view', v)
  }

  const open = (id: string) => navigate({ to: '/timelines/$id', params: { id } })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return timelines.filter((t) => {
      if (filter === 'public' && !t.isPublic) return false
      if (filter === 'private' && t.isPublic) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [timelines, filter, query])

  // Snap back to page 1 whenever the result set changes shape under us.
  useEffect(() => {
    setPage(1)
  }, [query, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * PAGE_SIZE
  const paged = filtered.slice(start, start + PAGE_SIZE)

  async function saveRename(id: string) {
    const t = editTitle.trim()
    setEditingId(null)
    if (!t) return
    await renameTimeline({ data: { id, title: t } })
    await qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete “${name}” and all its nodes? This can't be undone.`)) return
    await deleteTimeline({ data: id })
    await qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  const startEdit = (t: TimelineSummary) => {
    setEditingId(t.id)
    setEditTitle(t.title)
  }

  const editInput = (id: string, extra?: string) => (
    <Input
      autoFocus
      className={cn('h-9', extra)}
      value={editTitle}
      onChange={(e) => setEditTitle(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => void saveRename(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void saveRename(id)
        if (e.key === 'Escape') setEditingId(null)
      }}
    />
  )

  return (
    <section className="flex flex-col gap-5">
      {/* Title + toolbar */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Timelines</h2>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div
            className={cn(
              'flex flex-1 items-center gap-2 px-3 focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
              segmentSurface,
            )}
          >
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search timelines…"
              aria-label="Search timelines"
              autoComplete="off"
              spellCheck={false}
              className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className={cn('h-10 gap-2', segmentSurface)}>
                  <ListFilter className="size-4" />
                  {FILTER_LABEL[filter]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onSelect={() => setFilter(f)}
                    className={cn(f === filter && 'text-primary')}
                  >
                    {FILTER_LABEL[f]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View toggle — same linear-gradient surface as the cards. */}
            <div
              role="group"
              aria-label="Switch view"
              className={cn('flex items-center gap-0.5 p-0.5', segmentSurface)}
            >
              <ViewButton
                active={view === 'cards'}
                onClick={() => pickView('cards')}
                label="Cards"
                icon={<LayoutGrid className="size-4" />}
              />
              <ViewButton
                active={view === 'rows'}
                onClick={() => pickView('rows')}
                label="Rows"
                icon={<Rows3 className="size-4" />}
              />
            </div>

            {/* New timeline → dialog */}
            <Button className="h-10 shrink-0" onClick={() => setDialogOpen(true)}>
              <Plus />
              New timeline
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      {timelines.length === 0 ? (
        <EmptyState onCreate={() => setDialogOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No timelines match your search.
        </div>
      ) : view === 'cards' ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paged.map((t) => (
            <li key={t.id}>
              <div
                className={cn(
                  'group relative flex h-full flex-col gap-3 rounded-xl border border-border/60 bg-card bg-gradient-to-b from-foreground/[0.04] to-transparent p-4 shadow-sm transition-colors hover:border-border',
                )}
              >
                {editingId === t.id ? (
                  editInput(t.id)
                ) : (
                  <button
                    type="button"
                    onClick={() => open(t.id)}
                    className="flex flex-1 flex-col gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 font-medium">{t.title}</span>
                      {t.isPublic && (
                        <Badge variant="success" className="shrink-0 rounded-full">
                          Public
                        </Badge>
                      )}
                    </span>
                    {t.description && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    )}
                  </button>
                )}
                <div className="flex items-center justify-between">
                  <time
                    dateTime={new Date(t.createdAt).toISOString()}
                    className="text-xs text-muted-foreground"
                  >
                    {dateFmt.format(t.createdAt)}
                  </time>
                  <RowMenu
                    onRename={() => startEdit(t)}
                    onDelete={() => void remove(t.id, t.title)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card bg-gradient-to-b from-foreground/[0.04] to-transparent shadow-sm">
          {paged.map((t, i) => (
            <li
              key={t.id}
              className={cn(
                'group flex items-center gap-3 px-3 transition-colors hover:bg-accent/50',
                i > 0 && 'border-t border-border/50',
              )}
            >
              {editingId === t.id ? (
                <div className="flex-1 py-1.5">{editInput(t.id)}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => open(t.id)}
                  className="flex flex-1 cursor-pointer items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{t.title}</span>
                      {t.isPublic && (
                        <Badge variant="success" className="rounded-full">
                          Public
                        </Badge>
                      )}
                    </span>
                    {t.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    )}
                  </span>
                  <time
                    dateTime={new Date(t.createdAt).toISOString()}
                    className="hidden shrink-0 text-xs text-muted-foreground sm:block"
                  >
                    {dateFmt.format(t.createdAt)}
                  </time>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              <RowMenu onRename={() => startEdit(t)} onDelete={() => void remove(t.id, t.title)} />
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="px-1 text-xs text-muted-foreground">
              {safePage} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <NewTimelineDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  )
}

function ViewButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn(
        'grid size-9 cursor-pointer place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'bg-card text-foreground shadow-sm ring-1 ring-inset ring-border/60'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-14 text-center">
      <p className="text-sm text-muted-foreground">
        No timelines yet — create your first, then build it from your MCP client.
      </p>
      <Button onClick={onCreate}>
        <Plus />
        New timeline
      </Button>
    </div>
  )
}
