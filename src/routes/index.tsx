import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { listTimelines, createTimeline, renameTimeline, deleteTimeline } from '~/lib/server/timelines'
import { filesToParts } from '~/lib/files'
import { stashAttachments } from '~/lib/pending-attachments'

export const Route = createFileRoute('/')({
  component: Home,
})

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function RowMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="home-menu" ref={ref}>
      <button
        type="button"
        className="home-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Timeline actions"
        title="Actions"
      >
        ⋯
      </button>
      {open && (
        <div className="home-menu-list" role="menu">
          <button
            type="button"
            className="home-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="home-menu-item home-menu-del"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Home() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: timelines = [] } = useQuery({ queryKey: ['timelines'], queryFn: () => listTimelines() })
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const open = (id: string) => navigate({ to: '/timelines/$id', params: { id } })

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) setFiles((fs) => [...fs, ...picked])
    e.target.value = ''
  }

  // Type an idea → new timeline (titled from the prompt) → open it and let the
  // chat start building from that prompt (handed over via ?prompt=). Any attached
  // files are stashed and picked up by the timeline's first turn.
  async function build() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    try {
      const title = p.length > 70 ? `${p.slice(0, 69)}…` : p
      const created = await createTimeline({ data: { title } })
      if (files.length) stashAttachments(created.id, await filesToParts(files))
      setPrompt('')
      setFiles([])
      await qc.invalidateQueries({ queryKey: ['timelines'] })
      void navigate({ to: '/timelines/$id', params: { id: created.id }, search: { prompt: p } })
    } finally {
      setBusy(false)
    }
  }

  async function createBlank() {
    if (busy) return
    setBusy(true)
    try {
      const created = await createTimeline({ data: { title: 'Untitled timeline' } })
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
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1 className="home-title">Strata</h1>
          <p className="home-sub">Type an idea and watch an AI build the timeline.</p>
        </header>

        <form
          className="composer composer-home"
          onSubmit={(e) => {
            e.preventDefault()
            void build()
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            className="chat-file-input"
            onChange={onPickFiles}
          />
          {files.length > 0 && (
            <div className="composer-attachments">
              {files.map((f, i) => (
                <span className="attachment" key={`${f.name}:${i}`}>
                  <span className="attachment-icon" aria-hidden>
                    {f.type.startsWith('image/') ? '🖼' : '📄'}
                  </span>
                  <span className="attachment-name">{f.name}</span>
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-row">
            <button
              type="button"
              className="composer-attach"
              onClick={() => fileRef.current?.click()}
              title="Attach images or documents"
              aria-label="Attach files"
              disabled={busy}
            >
              📎
            </button>
            <textarea
              className="composer-input"
              rows={2}
              placeholder="Map the history of… (e.g. observability tooling, the electric car, jazz)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void build()
                }
              }}
            />
            <button className="composer-submit" type="submit" disabled={busy || !prompt.trim()}>
              {busy ? 'Creating…' : 'Build timeline →'}
            </button>
          </div>
        </form>
        <button type="button" className="home-blank" onClick={() => void createBlank()} disabled={busy}>
          or start a blank timeline
        </button>

        {timelines.length === 0 ? (
          <p className="home-empty">No timelines yet — type an idea above to build your first.</p>
        ) : (
          <table className="home-table">
            <thead>
              <tr>
                <th scope="col">Timeline</th>
                <th scope="col" className="home-th-date">Created</th>
                <th scope="col" className="home-th-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {timelines.map((t) => (
                <tr key={t.id} className="home-row">
                  <td className="home-cell-main">
                    {editingId === t.id ? (
                      <input
                        className="home-card-edit"
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
                      <button type="button" className="home-row-open" onClick={() => open(t.id)}>
                        <span className="home-row-title">{t.title}</span>
                        {t.description ? <span className="home-row-desc">{t.description}</span> : null}
                      </button>
                    )}
                  </td>
                  <td className="home-cell-date">
                    <time dateTime={new Date(t.createdAt).toISOString()}>{dateFmt.format(t.createdAt)}</time>
                  </td>
                  <td className="home-cell-actions">
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
      </div>
    </div>
  )
}
