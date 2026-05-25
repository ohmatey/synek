import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { renameTimeline } from '~/lib/server/timelines'

// Top-left identity bar: logo + the timeline name, editable inline.
export function AppBar({ timelineId, title }: { timelineId: string; title: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

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
    </div>
  )
}
