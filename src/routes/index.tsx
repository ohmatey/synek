import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { listTimelines, createTimeline, renameTimeline, deleteTimeline } from '~/lib/server/timelines'
import { initApiKeys, createApiKey, revokeApiKey } from '~/lib/server/api-keys'
import { useSession, signIn, signUp, signOut } from '~/lib/auth/client'
import { ClientOnly } from '~/components/client-only'

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

// MCP endpoint + API-key manager. The endpoint is public; key management lives
// behind auth (KeysSection, client-only) so only a signed-in user can mint keys.
function ConnectPanel() {
  const [origin, setOrigin] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}/api/mcp`

  return (
    <section className="home-connect">
      <h2 className="home-connect-title">Connect an MCP client</h2>
      <p className="home-connect-sub">
        Point your client (Claude Desktop, Claude Code) at the endpoint below and authenticate with an API
        key, then ask it to build and edit timelines. The app itself has no AI — your client brings the model.
      </p>

      <div className="home-connect-row">
        <span className="home-connect-label">Endpoint</span>
        <code className="home-connect-code">{url || '…'}</code>
        <button
          type="button"
          className="home-connect-copy"
          disabled={!origin}
          onClick={() => {
            void navigator.clipboard?.writeText(url)
            setCopiedUrl(true)
            setTimeout(() => setCopiedUrl(false), 1500)
          }}
        >
          {copiedUrl ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Session-aware; client-only to avoid running useSession during SSR. */}
      <ClientOnly fallback={<p className="home-connect-sub">Loading…</p>}>
        <KeysSection />
      </ClientOnly>
    </section>
  )
}

// Sign-in / sign-up form shown when logged out. Open registration (multi-user).
function AuthForms({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res =
        mode === 'signup'
          ? await signUp.email({ email, password, name: name.trim() || email.split('@')[0] })
          : await signIn.email({ email, password })
      if (res.error) {
        setError(res.error.message || 'Authentication failed')
        return
      }
      onAuthed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home-auth">
      <p className="home-connect-sub">Sign in to create and manage API keys.</p>
      <form className="home-auth-form" onSubmit={submit}>
        {mode === 'signup' && (
          <input
            className="composer-input"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
        )}
        <input
          className="composer-input"
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
        <input
          className="composer-input"
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        <button type="submit" className="home-connect-copy" disabled={busy}>
          {busy ? '…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
      {error && (
        <p className="home-auth-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="home-auth-toggle"
        onClick={() => {
          setMode((m) => (m === 'signup' ? 'signin' : 'signup'))
          setError(null)
        }}
      >
        {mode === 'signup' ? 'Have an account? Log in' : 'New here? Create an account'}
      </button>
    </div>
  )
}

// API-key management for the signed-in user (create / list / revoke). Mounts
// client-only; renders AuthForms when logged out.
function KeysSection() {
  const qc = useQueryClient()
  const { data: session, isPending } = useSession()
  const loggedIn = !!session?.user

  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ raw: string; label: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // First visit mints a "Default" key (show-once secret); afterwards a plain list.
  const { data } = useQuery({ queryKey: ['api-keys'], queryFn: () => initApiKeys(), enabled: loggedIn })
  const keys = data?.keys ?? []

  useEffect(() => {
    if (data?.created) setCreated({ raw: data.created.raw, label: data.created.key.label })
  }, [data?.created])

  function copy(text: string, which: string) {
    void navigator.clipboard?.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  async function create() {
    const name = label.trim()
    if (busy || !name) return
    setBusy(true)
    try {
      const { raw, key } = await createApiKey({ data: { label: name } })
      setCreated({ raw, label: key.label })
      setLabel('')
      await qc.invalidateQueries({ queryKey: ['api-keys'] })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke “${name}”? Any client using it will stop working immediately.`)) return
    await revokeApiKey({ data: id })
    await qc.invalidateQueries({ queryKey: ['api-keys'] })
  }

  async function logout() {
    await signOut()
    setCreated(null)
    await qc.invalidateQueries({ queryKey: ['api-keys'] })
  }

  if (isPending) return <p className="home-connect-sub">…</p>
  if (!loggedIn) return <AuthForms onAuthed={() => qc.invalidateQueries({ queryKey: ['api-keys'] })} />

  return (
    <>
      <div className="home-connect-row home-auth-status">
        <span className="home-connect-label">Account</span>
        <span className="home-auth-email">{session.user.email}</span>
        <button type="button" className="home-connect-copy" onClick={() => void logout()}>
          Sign out
        </button>
      </div>

      <form
        className="home-connect-row"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <span className="home-connect-label">New key</span>
        <input
          className="composer-input"
          placeholder="Name this key (e.g. Claude Desktop, laptop CLI)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="API key label"
        />
        <button type="submit" className="home-connect-copy" disabled={busy || !label.trim()}>
          {busy ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {created && (
        <div className="home-connect-row home-key-new" role="status">
          <span className="home-connect-label">Copy now</span>
          <code className="home-connect-code home-connect-token">{created.raw}</code>
          <button type="button" className="home-connect-copy" onClick={() => copy(created.raw, 'new')}>
            {copied === 'new' ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="home-connect-copy" onClick={() => setCreated(null)}>
            Done
          </button>
          <span className="home-key-once">Save it now — “{created.label}” won’t be shown again.</span>
        </div>
      )}

      {keys.length > 0 && (
        <table className="home-table home-keys-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Secret</th>
              <th scope="col" className="home-th-date">Created</th>
              <th scope="col" className="home-th-date">Last used</th>
              <th scope="col" className="home-th-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={`home-row${k.revokedAt ? ' home-key-revoked' : ''}`}>
                <td className="home-cell-main">
                  <span className="home-row-title">{k.label}</span>
                </td>
                <td>
                  <code className="home-connect-code">{k.prefix}…</code>
                  {k.revokedAt ? <span className="home-key-badge"> revoked</span> : null}
                </td>
                <td className="home-cell-date">
                  <time dateTime={new Date(k.createdAt).toISOString()}>{dateFmt.format(k.createdAt)}</time>
                </td>
                <td className="home-cell-date">{k.lastUsedAt ? dateFmt.format(k.lastUsedAt) : '—'}</td>
                <td className="home-cell-actions">
                  {!k.revokedAt && (
                    <button type="button" className="home-menu-item home-menu-del" onClick={() => void revoke(k.id, k.label)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
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
