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

// Small copy-to-clipboard button used across the connect guide.
function CopyButton({ text, className = 'copy-btn' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Header ────────────────────────────────────────────────────────────────

function AuthArea() {
  const qc = useQueryClient()
  const { data: session, isPending } = useSession()

  async function logout() {
    await signOut()
    await qc.invalidateQueries()
  }

  if (isPending) return <span className="hdr-auth-muted">…</span>
  if (!session?.user)
    return (
      <a className="hdr-signin" href="#auth">
        Sign in
      </a>
    )
  return (
    <div className="hdr-auth">
      <span className="hdr-auth-email" title={session.user.email}>
        {session.user.email}
      </span>
      <button type="button" className="hdr-signout" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  )
}

// ── Auth (sign in / sign up) ────────────────────────────────────────────────

function AuthForms() {
  const qc = useQueryClient()
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
      await qc.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-card" id="auth">
      <h2 className="auth-title">{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
      <p className="auth-sub">
        {mode === 'signup'
          ? 'An account holds your timelines and API keys.'
          : 'Sign in to your timelines and API keys.'}
      </p>
      <form className="auth-form" onSubmit={submit}>
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
        <button type="submit" className="composer-submit" disabled={busy}>
          {busy ? '…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="auth-toggle"
        onClick={() => {
          setMode((m) => (m === 'signup' ? 'signin' : 'signup'))
          setError(null)
        }}
      >
        {mode === 'signup' ? 'Have an account? Log in' : 'New here? Create an account'}
      </button>
    </section>
  )
}

function SignedOut() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <h2 className="landing-h">A timeline canvas your AI builds for you.</h2>
        <p className="landing-p">
          Strata holds no AI of its own. Connect your MCP client (Claude Desktop, Claude Code) with an API
          key and ask it to build and edit a visual, time-anchored mesh of events, people, and ideas. The
          canvas is the viewer; your client brings the model.
        </p>
        <ol className="landing-steps">
          <li>
            <span className="landing-step-n">1</span> Create an account
          </li>
          <li>
            <span className="landing-step-n">2</span> Generate an API key
          </li>
          <li>
            <span className="landing-step-n">3</span> Connect your MCP client &amp; start building
          </li>
        </ol>
      </div>
      <AuthForms />
    </div>
  )
}

// ── Timelines (your own) ─────────────────────────────────────────────────────

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

function TimelinesSection() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: timelines = [] } = useQuery({ queryKey: ['timelines'], queryFn: () => listTimelines() })
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
    <section className="panel">
      <h2 className="panel-title">Your timelines</h2>
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

      {timelines.length === 0 ? (
        <p className="home-empty">No timelines yet — create your first above, then build it from your MCP client.</p>
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
                      {t.isPublic ? <span className="home-row-public">Public</span> : null}
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
    </section>
  )
}

// ── API keys ─────────────────────────────────────────────────────────────────

function KeysPanel({ onFreshKey }: { onFreshKey: (raw: string) => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ raw: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // First visit mints a "Default" key (show-once secret); afterwards a plain list.
  const { data } = useQuery({ queryKey: ['api-keys'], queryFn: () => initApiKeys() })
  const keys = data?.keys ?? []

  useEffect(() => {
    if (data?.created) {
      setCreated({ raw: data.created.raw, label: data.created.key.label })
      onFreshKey(data.created.raw)
    }
  }, [data?.created, onFreshKey])

  async function create() {
    const name = label.trim()
    if (busy || !name) return
    setBusy(true)
    try {
      const { raw, key } = await createApiKey({ data: { label: name } })
      setCreated({ raw, label: key.label })
      onFreshKey(raw)
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

  return (
    <div className="keys">
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
          <button
            type="button"
            className="home-connect-copy"
            onClick={() => {
              void navigator.clipboard?.writeText(created.raw)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
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
    </div>
  )
}

// ── Connect guide (instructions) ──────────────────────────────────────────────

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} className="code-copy" />
    </div>
  )
}

function ConnectGuide({ apiKey }: { apiKey: string | null }) {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin || 'http://localhost:3001'}/api/mcp`
  const key = apiKey ?? '<YOUR_API_KEY>'

  const claudeCode = `claude mcp add --transport http synek ${url} \\\n  --header "Authorization: Bearer ${key}"`
  const desktopJson = JSON.stringify(
    { mcpServers: { synek: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${key}`] } } },
    null,
    2,
  )

  return (
    <div className="connect-guide">
      <div className="home-connect-row">
        <span className="home-connect-label">Endpoint</span>
        <code className="home-connect-code" data-testid="mcp-endpoint">
          {url}
        </code>
        <CopyButton text={url} className="home-connect-copy" />
      </div>

      {!apiKey && (
        <p className="connect-hint">Create a key above — it’ll be filled into the commands below automatically (just this once).</p>
      )}

      <div className="connect-step">
        <h4 className="connect-step-title">Claude Code</h4>
        <CodeBlock code={claudeCode} />
      </div>

      <div className="connect-step">
        <h4 className="connect-step-title">Claude Desktop</h4>
        <p className="connect-step-sub">Add to <code>claude_desktop_config.json</code> (bridges the HTTP endpoint over stdio), then restart Desktop.</p>
        <CodeBlock code={desktopJson} />
      </div>

      <div className="connect-step">
        <h4 className="connect-step-title">Get the skills</h4>
        <p className="connect-step-sub">
          Install the <strong>Synek plugin</strong> for skills that teach your client to build great
          timelines (mapping a domain, deepening, sourcing) and to connect/troubleshoot:
        </p>
        <CodeBlock code={'/plugin marketplace add ohmatey/synek-plugin\n/plugin install synek'} />
        <p className="connect-step-sub">
          Then just ask: <em>“map the history of observability tooling”</em> and watch the canvas fill in.
        </p>
      </div>
    </div>
  )
}

// ── Signed-in dashboard ───────────────────────────────────────────────────────

function SignedIn() {
  const [freshKey, setFreshKey] = useState<string | null>(null)
  return (
    <div className="dashboard">
      <TimelinesSection />
      <section className="panel">
        <h2 className="panel-title">Connect an MCP client</h2>
        <p className="home-connect-sub">
          Point your client (Claude Desktop, Claude Code) at the endpoint with an API key, then ask it to
          build and edit timelines. The app itself has no AI — your client brings the model.
        </p>
        <KeysPanel onFreshKey={setFreshKey} />
        <ConnectGuide apiKey={freshKey} />
      </section>
    </div>
  )
}

function HomeBody() {
  const { data: session, isPending } = useSession()
  if (isPending) return <p className="home-sub">Loading…</p>
  return session?.user ? <SignedIn /> : <SignedOut />
}

function Home() {
  return (
    <div className="app">
      <header className="app-header">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" className="brand-mark" width={28} height={28} />
          <span className="brand-name">Strata</span>
        </a>
        <ClientOnly>
          <AuthArea />
        </ClientOnly>
      </header>
      <main className="home">
        <div className="home-inner">
          <ClientOnly fallback={<p className="home-sub">Loading…</p>}>
            <HomeBody />
          </ClientOnly>
        </div>
      </main>
    </div>
  )
}
