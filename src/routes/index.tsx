import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { listTimelines, createTimeline, renameTimeline, deleteTimeline } from '~/lib/server/timelines'
import { filesToParts } from '~/lib/files'
import { stashAttachments } from '~/lib/pending-attachments'

export const Route = createFileRoute('/')({
  component: Home,
})

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
          className="home-prompt"
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
          <button
            type="button"
            className="chat-attach"
            onClick={() => fileRef.current?.click()}
            title="Attach images or documents"
            aria-label="Attach files"
            disabled={busy}
          >
            📎
          </button>
          <textarea
            className="home-prompt-input"
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
          <button className="home-prompt-btn" type="submit" disabled={busy || !prompt.trim()}>
            {busy ? 'Creating…' : 'Build timeline →'}
          </button>
        </form>
        {files.length > 0 && (
          <div className="home-attachments">
            {files.map((f, i) => (
              <span className="chat-attachment" key={`${f.name}:${i}`}>
                <span className="chat-attachment-name">
                  {f.type.startsWith('image/') ? '🖼' : '📄'} {f.name}
                </span>
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <button type="button" className="home-blank" onClick={() => void createBlank()} disabled={busy}>
          or start a blank timeline
        </button>

        {timelines.length === 0 ? (
          <p className="home-empty">No timelines yet — type an idea above to build your first.</p>
        ) : (
          <ul className="home-list">
            {timelines.map((t) => (
              <li key={t.id} className="home-card">
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
                  <button type="button" className="home-card-open" onClick={() => open(t.id)}>
                    <span className="home-card-title">{t.title}</span>
                    <span className="home-card-date">{new Date(t.createdAt).toLocaleDateString()}</span>
                  </button>
                )}
                <div className="home-card-actions">
                  <button
                    type="button"
                    className="home-card-btn"
                    onClick={() => {
                      setEditingId(t.id)
                      setEditTitle(t.title)
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="home-card-btn home-card-del" onClick={() => void remove(t.id, t.title)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
