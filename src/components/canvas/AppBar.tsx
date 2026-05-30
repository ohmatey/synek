import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuTrigger,
  ThemeToggle,
  cn,
} from '@strata/ui'
import { listTimelines, renameTimeline, setTimelineVisibility } from '~/lib/server/timelines'

// Top-left identity bar: logo + the timeline name (editable inline by the owner),
// a switcher dropdown (owner only), Share control (owner only), and theme toggle.
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

  // Switcher lists the owner's timelines — only fetched (and shown) for the owner;
  // listTimelines requires a session, so a public viewer must not call it.
  const { data: timelines } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
    enabled: isOwner,
  })

  async function save() {
    const t = draft.trim()
    setEditing(false)
    if (!t || t === title) return
    await renameTimeline({ data: { id: timelineId, title: t } })
    void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    void qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-2 rounded-[var(--radius-control)]',
        'border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/85',
        'px-3 py-1.5 backdrop-blur shadow-[var(--shadow-card)]',
      )}
    >
      <Link
        to="/"
        className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-fg-primary)] hover:text-[var(--color-accent-primary)] transition-colors"
        title="Home"
      >
        <img src="/favicon.svg" alt="" width={18} height={18} className="opacity-90" />
        Strata
      </Link>
      <span aria-hidden className="text-[var(--color-fg-subtle)]">
        /
      </span>
      {isOwner && editing ? (
        <Input
          autoFocus
          size="sm"
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
          className="w-56"
        />
      ) : isOwner ? (
        <button
          type="button"
          title="Rename timeline"
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
          className={cn(
            'app-bar-name rounded px-1.5 py-0.5 text-sm font-medium text-[var(--color-fg-primary)]',
            'transition-colors hover:bg-[var(--color-bg-elevated)] truncate max-w-[28ch]',
          )}
        >
          {title}
        </button>
      ) : (
        <span className="app-bar-name px-1.5 py-0.5 text-sm font-medium text-[var(--color-fg-secondary)] truncate max-w-[28ch]">
          {title}
        </span>
      )}

      {isOwner && (
        <Menu>
          <MenuTrigger
            aria-label="Switch timeline"
            title="Switch timeline"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-xs text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)]"
          >
            ▾
          </MenuTrigger>
          <MenuList className="max-h-72 overflow-auto">
            {(timelines ?? []).length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                No timelines yet.
              </div>
            ) : (
              (timelines ?? []).map((t) => (
                <MenuItem
                  key={t.id}
                  onSelect={() => {
                    if (t.id !== timelineId)
                      void navigate({ to: '/timelines/$id', params: { id: t.id } })
                  }}
                  className={t.id === timelineId ? 'text-[var(--color-accent-primary)]' : undefined}
                >
                  <span className="flex items-center gap-2">
                    {t.title}
                    {t.id === timelineId && <span aria-hidden>✓</span>}
                  </span>
                </MenuItem>
              ))
            )}
          </MenuList>
        </Menu>
      )}

      {isOwner && <ShareControl timelineId={timelineId} isPublic={isPublic} />}
      {!isOwner && isPublic && (
        <Badge variant="primary" appearance="soft">
          Public · read-only
        </Badge>
      )}

      <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--color-border-subtle)]" />
      <ThemeToggle className="h-7 w-7" />
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

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/timelines/${timelineId}` : ''

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
    <div ref={ref} className="relative inline-block">
      <Button
        size="sm"
        variant={pub ? 'primary' : 'ghost'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {pub ? '🔗 Public' : '🔒 Private'}
      </Button>
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-1 flex flex-col gap-2 p-3',
            'min-w-[20rem] rounded-[var(--radius-control)]',
            'bg-[var(--color-bg-overlay)] border border-[var(--color-border-default)]',
            'shadow-[var(--shadow-overlay)] text-sm text-[var(--color-fg-primary)]',
          )}
        >
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pub}
              disabled={busy}
              onChange={() => void toggle()}
              className="accent-[var(--color-accent-primary)]"
            />
            Anyone with the link can view
          </label>
          {pub && (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-[var(--color-bg-base)] px-2 py-1 font-mono text-xs text-[var(--color-fg-secondary)] border border-[var(--color-border-default)]">
                {shareUrl}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
