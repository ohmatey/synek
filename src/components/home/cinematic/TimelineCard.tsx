import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { deleteTimeline, renameTimeline } from '~/lib/server/timelines'
import type { ProjectSummary, TimelineSummary } from '~/lib/domain/types'
import { MoveToProjectSubmenu } from './MoveToProjectSubmenu'
import { useMoveTimeline } from './useMoveTimeline'

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// One timeline in the home "Timelines" carousel (Wren §5). The card opens the
// canvas; the overflow menu carries Rename / Move to project / Delete. This is a
// deliberate standalone menu (a fresh DropdownMenu, not RowMenu) — folding it back
// into the shared RowMenu is a documented fast-follow (local-126), not done here.
// Inline rename uses the same draft/blur/Enter pattern as TimelinesSection.
export function TimelineCard({
  timeline,
  projects,
}: {
  timeline: TimelineSummary
  projects: ProjectSummary[]
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const move = useMoveTimeline()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(timeline.title)

  const open = () => void navigate({ to: '/timelines/$id', params: { id: timeline.id } })

  async function saveRename() {
    const t = draft.trim()
    setEditing(false)
    if (!t || t === timeline.title) return
    await renameTimeline({ data: { id: timeline.id, title: t } })
    await qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  async function remove() {
    if (!window.confirm(`Delete “${timeline.title}” and all its nodes? This can't be undone.`)) return
    await deleteTimeline({ data: timeline.id })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['timelines'] }),
      qc.invalidateQueries({ queryKey: ['home-stories'] }),
    ])
  }

  const showMove = projects.length > 1

  return (
    <article className="ch-tl-card">
      {editing ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <Input
            autoFocus
            className="h-9"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Timeline name"
          />
        </div>
      ) : (
        <button type="button" className="ch-tl-open" onClick={open} aria-label={`Open “${timeline.title}”`}>
          <span className="ch-tl-titlerow">
            <span className="ch-tl-title">{timeline.title}</span>
            {timeline.isPublic && (
              <Badge variant="success" className="shrink-0 rounded-full">
                Public
              </Badge>
            )}
          </span>
          {timeline.description && <span className="ch-tl-desc">{timeline.description}</span>}
          <time dateTime={new Date(timeline.createdAt).toISOString()} className="ch-tl-date">
            {dateFmt.format(timeline.createdAt)}
          </time>
        </button>
      )}

      <div className="ch-tl-menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent"
              aria-label={`Actions for “${timeline.title}”`}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={() => {
                setDraft(timeline.title)
                setEditing(true)
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            {showMove && (
              <MoveToProjectSubmenu
                projects={projects}
                currentProjectId={timeline.projectId}
                onMove={(target) =>
                  void move({
                    timelineId: timeline.id,
                    fromProjectId: timeline.projectId,
                    targetProjectId: target.id,
                    targetProjectTitle: target.title,
                    itemLabel: timeline.title,
                  })
                }
              />
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
