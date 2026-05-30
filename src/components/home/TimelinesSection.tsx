import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Input, cn } from '@strata/ui'
import { createTimeline, deleteTimeline, listTimelines, renameTimeline } from '~/lib/server/timelines'
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
    <Card elevation="flat" padding="lg" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        Your timelines
      </h2>
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
        <Button type="submit" variant="primary" loading={busy} className="shrink-0">
          New timeline →
        </Button>
      </form>

      {timelines.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-default)] px-4 py-6 text-center text-sm text-[var(--color-fg-muted)]">
          No timelines yet — create your first above, then build it from your MCP client.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">
              <th scope="col" className="py-2 font-medium">Timeline</th>
              <th scope="col" className="py-2 font-medium hidden sm:table-cell">Created</th>
              <th scope="col" className="py-2 w-12 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {timelines.map((t) => (
              <tr
                key={t.id}
                className="group border-b border-[var(--color-border-faint)] last:border-b-0 transition-colors hover:bg-[var(--color-bg-elevated)]"
              >
                <td className="py-2">
                  {editingId === t.id ? (
                    <Input
                      autoFocus
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
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 text-left',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
                      )}
                    >
                      <span className="flex items-center gap-2 text-[var(--color-fg-primary)]">
                        {t.title}
                        {t.isPublic && <Badge variant="primary" appearance="soft">Public</Badge>}
                      </span>
                      {t.description && (
                        <span className="text-xs text-[var(--color-fg-muted)]">{t.description}</span>
                      )}
                    </button>
                  )}
                </td>
                <td className="py-2 hidden sm:table-cell text-[var(--color-fg-muted)] text-xs">
                  <time dateTime={new Date(t.createdAt).toISOString()}>
                    {dateFmt.format(t.createdAt)}
                  </time>
                </td>
                <td className="py-2 text-right">
                  <RowMenu
                    onRename={() => {
                      setEditingId(t.id)
                      setEditTitle(t.title)
                    }}
                    onDelete={() => void remove(t.id, t.title)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
