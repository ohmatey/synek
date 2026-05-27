import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listTimelines, renameTimeline, setTimelineVisibility } from '~/lib/server/timelines'

// Top-left identity bar: logo + the timeline name (editable inline by the owner),
// a switcher dropdown (owner only), and a Share control (owner only).
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
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  // Switcher lists the owner's timelines — only fetched (and shown) for the owner;
  // listTimelines requires a session, so a public viewer must not call it.
  const { data: timelines } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
    enabled: isOwner,
  })

  useEffect(() => {
    if (!switcherOpen) return
    const onDown = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSwitcherOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [switcherOpen])

  async function save() {
    const t = draft.trim()
    setEditing(false)
    if (!t || t === title) return
    await renameTimeline({ data: { id: timelineId, title: t } })
    // Title rides the graph DTO, so refresh it (and the home list).
    void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    void qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  return (
    <div className="app-bar">
      <Link to="/" className="app-bar-logo" title="Home">
        <span className="app-bar-mark" aria-hidden />
        Strata
      </Link>
      <span className="app-bar-sep" aria-hidden>
        /
      </span>
      {isOwner && editing ? (
        <input
          className="app-bar-name-edit"
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
        />
      ) : isOwner ? (
        <button
          type="button"
          className="app-bar-name"
          title="Rename timeline"
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        >
          {title}
        </button>
      ) : (
        <span className="app-bar-name app-bar-name-readonly">{title}</span>
      )}
      {isOwner && (
        <div className="app-bar-switcher" ref={switcherRef}>
          <button
            type="button"
            className="app-bar-switch-btn"
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-expanded={switcherOpen}
            title="Switch timeline"
            aria-label="Switch timeline"
          >
            ▾
          </button>
          {switcherOpen && (
            <div className="app-bar-menu" role="menu">
              {(timelines ?? []).length === 0 ? (
                <div className="app-bar-menu-empty">No timelines yet.</div>
              ) : (
                (timelines ?? []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    className={`app-bar-menu-item${t.id === timelineId ? ' is-active' : ''}`}
                    onClick={() => {
                      setSwitcherOpen(false)
                      if (t.id !== timelineId) void navigate({ to: '/timelines/$id', params: { id: t.id } })
                    }}
                  >
                    <span className="app-bar-menu-title">{t.title}</span>
                    {t.id === timelineId && <span className="app-bar-menu-check" aria-hidden>✓</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {isOwner && <ShareControl timelineId={timelineId} isPublic={isPublic} />}
      {!isOwner && isPublic && <span className="app-bar-public-badge">Public · read-only</span>}
    </div>
  )
}

// Owner-only sharing: toggle public/private and, when public, copy the share URL.
function ShareControl({ timelineId, isPublic }: { timelineId: string; isPublic: boolean }) {
  const qc = useQueryClient()
  const [pub, setPub] = useState(isPublic)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setPub(isPublic), [isPublic])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/timelines/${timelineId}` : ''

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const next = !pub
      await setTimelineVisibility({ data: { id: timelineId, isPublic: next } })
      setPub(next)
      void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      void qc.invalidateQueries({ queryKey: ['timelines'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-bar-share" ref={ref}>
      <button
        type="button"
        className={`app-bar-share-btn${pub ? ' is-public' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Sharing"
      >
        {pub ? '🔗 Public' : '🔒 Private'}
      </button>
      {open && (
        <div className="app-bar-share-menu">
          <label className="app-bar-share-row">
            <input type="checkbox" checked={pub} disabled={busy} onChange={() => void toggle()} />
            Anyone with the link can view
          </label>
          {pub && (
            <div className="app-bar-share-row">
              <code className="app-bar-share-url">{shareUrl}</code>
              <button
                type="button"
                className="app-bar-share-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
