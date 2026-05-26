import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listTimelines, renameTimeline } from '~/lib/server/timelines'

// Top-left identity bar: logo + the timeline name, editable inline, plus a
// switcher dropdown to jump between timelines.
export function AppBar({ timelineId, title }: { timelineId: string; title: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  const { data: timelines } = useQuery({ queryKey: ['timelines'], queryFn: () => listTimelines() })

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
      {editing ? (
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
      ) : (
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
      )}
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
    </div>
  )
}
