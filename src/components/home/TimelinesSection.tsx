import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Plus } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  createTimeline,
  deleteTimeline,
  listTimelines,
  renameTimeline,
} from '~/lib/server/timelines'
import { RowMenu } from './RowMenu'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function TimelinesSection() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: timelines = [] } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
  })
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const open = (id: string) => navigate({ to: '/timelines/$id', params: { id } })

  async function create() {
    if (busy) return
    setBusy(true)
    try {
      const t = title.trim()
      const created = await createTimeline({ data: { title: t || 'Untitled timeline' } })
      setTitle('')
      await qc.invalidateQueries({ queryKey: ['timelines'] })
      open(created.id)
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Your timelines
          {timelines.length > 0 && (
            <Badge variant="secondary" className="rounded-full">
              {timelines.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Input
            className="flex-1"
            placeholder="Name a timeline (e.g. observability tooling, the electric car, jazz)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="shrink-0">
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            New timeline
          </Button>
        </form>

        {timelines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No timelines yet — create your first above, then build it from your MCP client.
            </p>
          </div>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {timelines.map((t) => (
              <li
                key={t.id}
                className="group flex items-center gap-3 rounded-lg px-2 transition-colors hover:bg-accent/60"
              >
                {editingId === t.id ? (
                  <Input
                    autoFocus
                    className="my-1.5 h-9"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => void saveRename(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(t.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => open(t.id)}
                    className="flex flex-1 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                <RowMenu
                  onRename={() => {
                    setEditingId(t.id)
                    setEditTitle(t.title)
                  }}
                  onDelete={() => void remove(t.id, t.title)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
