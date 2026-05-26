import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { listTimelines, createTimeline, renameTimeline, deleteTimeline } from '~/lib/server/timelines'
import { getMcpToken } from '~/lib/server/mcp-access'

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

// Shows the MCP endpoint + a reveal/copy of the access token, so users can
// connect a client without the `bun run issue:key` CLI.
function ConnectPanel() {
  const [origin, setOrigin] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'url' | 'token' | null>(null)

  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}/api/mcp`

  async function reveal() {
    if (busy || token) return
    setBusy(true)
    try {
      const { token } = await getMcpToken()
      setToken(token)
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string, which: 'url' | 'token') {
    void navigator.clipboard?.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <section className="home-connect">
      <h2 className="home-connect-title">Connect an MCP client</h2>
      <p className="home-connect-sub">
        Point your client (Claude Desktop, Claude Code) at the endpoint below with the access token, then
        ask it to build and edit timelines. The app itself has no AI — your client brings the model.
      </p>
      <div className="home-connect-row">
        <span className="home-connect-label">Endpoint</span>
        <code className="home-connect-code">{url || '…'}</code>
        <button type="button" className="home-connect-copy" onClick={() => copy(url, 'url')} disabled={!origin}>
          {copied === 'url' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="home-connect-row">
        <span className="home-connect-label">Token</span>
        {token ? (
          <code className="home-connect-code home-connect-token">{token}</code>
        ) : (
          <span className="home-connect-hidden">•••••••••••••••• (header: Authorization: Bearer …)</span>
        )}
        {token ? (
          <button type="button" className="home-connect-copy" onClick={() => copy(token, 'token')}>
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
        ) : (
          <button type="button" className="home-connect-copy" onClick={() => void reveal()} disabled={busy}>
            {busy ? 'Generating…' : 'Reveal token'}
          </button>
        )}
      </div>
    </section>
  )
}

function Home() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: timelines = [] } = useQuery({ queryKey: ['timelines'], queryFn: () => listTimelines() })
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const open = (id: string) => navigate({ to: '/timelines/$id', params: { id } })

  // Create a new timeline and open it. Content is built by an external MCP client.
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
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1 className="home-title">Strata</h1>
          <p className="home-sub">Create a timeline, then build it from your MCP client.</p>
        </header>

        <form
          className="composer composer-home"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="composer-row">
            <input
              className="composer-input"
              placeholder="Name a timeline (e.g. observability tooling, the electric car, jazz)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="composer-submit" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'New timeline →'}
            </button>
          </div>
        </form>

        <ConnectPanel />

        {timelines.length === 0 ? (
          <p className="home-empty">No timelines yet — create your first above.</p>
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
