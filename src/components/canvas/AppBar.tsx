import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'
import { listTimelines, renameTimeline } from '~/lib/server/timelines'
import { floatChip } from './chrome'

// Top-left identity: a row of independently floating chips — logo and the
// timeline name (editable inline by the owner) + switcher. Sharing and the
// account menu float at the FAR RIGHT of the bar (see TimelineCanvas's toolbar);
// only the identity lives here on the left.
export function AppBar({
  timelineId,
  title,
  isOwner,
  isPublic,
}: {
  timelineId: string
  title: string
  isOwner: boolean
  isPublic: boolean
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  // Switcher lists the owner's timelines — only fetched (and shown) for the owner;
  // listTimelines requires a session, so a public viewer must not call it.
  const { data: timelines } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
    enabled: isOwner,
  })

  async function save() {
    const t = draft.trim()
    setEditing(false)
    if (!t || t === title) return
    await renameTimeline({ data: { id: timelineId, title: t } })
    void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    void qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  return (
    <div className="flex items-center gap-2">
      {/* Logo chip */}
      <Link
        to="/"
        className={cn(
          floatChip,
          'flex h-8 items-center gap-1.5 px-2.5 text-sm font-semibold transition-colors hover:text-primary',
        )}
        title="Home"
      >
        <span className="grid size-5 place-items-center rounded-md bg-gradient-to-br from-primary to-influence ring-1 ring-inset ring-white/10">
          <img src="/favicon.svg" alt="" width={12} height={12} className="opacity-95" />
        </span>
        Synek
      </Link>

      {/* Timeline name (+ switcher) chip */}
      {isOwner && editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') {
              setDraft(title)
              setEditing(false)
            }
          }}
          className={cn(floatChip, 'h-8 w-56')}
        />
      ) : (
        <div className={cn(floatChip, 'flex h-8 items-center gap-0.5 pl-2.5 pr-1')}>
          {isOwner ? (
            <button
              type="button"
              title="Rename timeline"
              data-testid="timeline-name"
              onClick={() => {
                setDraft(title)
                setEditing(true)
              }}
              className="max-w-[24ch] cursor-pointer truncate rounded text-sm font-medium outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {title}
            </button>
          ) : (
            <span
              data-testid="timeline-name"
              className="max-w-[24ch] truncate text-sm font-medium text-muted-foreground"
            >
              {title}
            </span>
          )}

          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground"
                  aria-label="Switch timeline"
                  title="Switch timeline"
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-auto">
                {(timelines ?? []).length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No timelines yet.</div>
                ) : (
                  (timelines ?? []).map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => {
                        if (t.id !== timelineId)
                          void navigate({ to: '/timelines/$id', params: { id: t.id } })
                      }}
                      className={cn(t.id === timelineId && 'text-primary')}
                    >
                      <span className="flex-1 truncate">{t.title}</span>
                      {t.id === timelineId && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Read-only badge for a public viewer (the owner gets the Share control on
          the right instead). */}
      {!isOwner && isPublic && (
        <Badge variant="soft" className={cn(floatChip, 'h-8 rounded-lg px-3')}>
          Public · read-only
        </Badge>
      )}
    </div>
  )
}
