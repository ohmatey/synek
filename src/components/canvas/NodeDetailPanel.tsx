import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { parseDate, formatInstant } from '~/lib/domain/dates'
import { editNode, deleteNode } from '~/lib/server/nodes'
import { fileToDataUrl } from '~/lib/files'
import { NODE_SIZES, NODE_SUBTYPES } from '~/lib/domain/types'
import type { GraphNode, GraphEdge, CanvasCitation, NodeImage, NodeSize, NodeSubtype, NodeType, Precision, EdgeKind } from '~/lib/domain/types'
import type { NodeDraft } from './types'

// Mirrors the canvas edge palette. CSS vars flip per theme automatically;
// kept local to avoid importing TimelineCanvas (which imports this panel).
const REL_COLOR: Record<EdgeKind, string> = {
  caused: 'var(--color-accent-story)',
  succeeded: 'var(--color-accent-dialogue)',
  influenced: 'var(--color-accent-influence)',
  acquired: 'var(--color-danger)',
  competed_with: 'var(--color-success)',
}

// Default accent per node type (used for the title dot when no custom color).
const TYPE_DOT: Record<NodeType, string> = {
  period: 'var(--color-accent-influence)',
  entity: 'var(--color-fg-muted)',
  event: 'var(--color-accent-primary)',
  concept: 'var(--color-accent-dialogue)',
}

// Swatches offered in the node Color property. Kept as raw hex on purpose:
// node accents are user-chosen domain identity — they must read the same in
// both themes (a "red" node stays red regardless of light/dark).
const COLOR_PRESETS = ['#3a6df0', '#6aa9ff', '#52c41a', '#e0a458', '#9b8cff', '#ff6a8b']

// Render an instant back into a string parseDate() can re-read. formatInstant
// emits month *names* ("Sep 2008") which parseDate can't parse, so it would
// silently drop precision on round-trip — use numeric forms instead.
function toInputDate(instant: number, precision: Precision): string {
  const d = new Date(instant)
  const y = d.getUTCFullYear()
  if (y <= 0) return `${-y + 1} BCE` // BCE only round-trips at year precision
  if (precision === 'year') return `${y}`
  if (precision === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  if (precision === 'month') return `${y}-${mm}`
  return `${y}-${mm}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const EMPTY_CITATION: CanvasCitation = { title: '' }

export function NodeDetailPanel({
  node,
  edges,
  nodes,
  timelineId,
  readOnly = false,
  onClose,
  onSelectNode,
  onDraft,
}: {
  node: GraphNode
  edges: GraphEdge[]
  nodes: GraphNode[]
  timelineId: string
  readOnly?: boolean
  onClose: () => void
  onSelectNode: (id: string) => void
  onDraft: (draft: NodeDraft | null) => void
}) {
  const qc = useQueryClient()
  const hasSpan = node.type !== 'event'

  // Edges touching this node, resolved to the other endpoint's title.
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const relations = edges
    .filter((e) => e.sourceId === node.id || e.targetId === node.id)
    .map((e) => {
      const outgoing = e.sourceId === node.id
      const otherId = outgoing ? e.targetId : e.sourceId
      return { id: e.id, outgoing, kind: e.kind, label: e.label, otherId, otherTitle: nodeById.get(otherId)?.title ?? otherId }
    })

  const [title, setTitle] = useState(node.title)
  const [summary, setSummary] = useState(node.summary ?? '')
  const [start, setStart] = useState(toInputDate(node.startInstant, node.precision))
  const [end, setEnd] = useState(node.endInstant != null ? toInputDate(node.endInstant, node.precision) : '')
  const [citations, setCitations] = useState<CanvasCitation[]>(node.citations)
  const [images, setImages] = useState<NodeImage[]>(node.images)
  const [size, setSize] = useState<NodeSize>(node.size)
  const [color, setColor] = useState<string | null>(node.color)
  const [subtype, setSubtype] = useState<NodeSubtype | null>(node.subtype)
  const imgRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // Read-first: only the clicked field shows an editor at a time.
  const [editing, setEditing] = useState<'title' | 'summary' | 'date' | 'end' | null>(null)

  const parsedStart = parseDate(start)

  // Live preview: publish in-progress edits so the canvas reflects them without
  // persisting. Save commits them; closing/canceling drops the draft (revert).
  useEffect(() => {
    onDraft({
      title: title.trim() || node.title,
      startInstant: parsedStart.instant,
      precision: parsedStart.precision,
      endInstant: hasSpan && end.trim() ? parseDate(end).instant : null,
      size,
      color,
      images,
      subtype,
    })
  }, [title, start, end, size, color, images, subtype, hasSpan, node.title, parsedStart.instant, parsedStart.precision, onDraft])

  useEffect(() => () => onDraft(null), [onDraft])

  async function refetch() {
    await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    void qc.invalidateQueries({ queryKey: ['history', timelineId] })
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const cleanCitations = citations.filter((c) => c.title.trim())
      await editNode({
        data: {
          timelineId,
          nodeId: node.id,
          patch: {
            title: title.trim() || node.title,
            summary: summary.trim() ? summary : null,
            startInstant: parsedStart.instant,
            precision: parsedStart.precision,
            ...(hasSpan ? { endInstant: end.trim() ? parseDate(end).instant : null } : {}),
            citations: cleanCitations,
            images,
            size,
            color,
            subtype,
          },
        },
      })
      await refetch()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      await deleteNode({ data: { timelineId, nodeId: node.id } })
      await refetch()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  function updateCitation(i: number, field: keyof CanvasCitation, value: string) {
    setCitations((cs) => cs.map((c, j) => (j === i ? { ...c, [field]: value } : c)))
  }

  async function onPickImages(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (!picked.length) return
    const added: NodeImage[] = await Promise.all(
      picked.map(async (f) => ({ url: await fileToDataUrl(f), alt: f.name, show: true })),
    )
    setImages((xs) => [...xs, ...added])
  }

  function toggleImage(i: number) {
    setImages((xs) => xs.map((im, j) => (j === i ? { ...im, show: !im.show } : im)))
  }

  function removeImage(i: number) {
    setImages((xs) => xs.filter((_, j) => j !== i))
  }

  const endParsed = end.trim() ? parseDate(end) : null

  return (
    <div className="detail-panel" role="dialog" aria-label="Node details">
      <header className="detail-head">
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={remove}
            disabled={busy}
            aria-label="Delete node"
            title="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!readOnly && (
            <Button size="sm" className="h-7 px-3" onClick={save} disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? 'Saving…' : 'Save'}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="-mr-1 size-7" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </header>

      {/* Title — doc heading with an accent dot, click to edit */}
      <div className="detail-title-row">
        <span className="detail-title-dot" style={{ background: color ?? TYPE_DOT[node.type] }} aria-hidden />
        {editing === 'title' ? (
          <input
            className="detail-title-input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                setEditing(null)
              }
            }}
          />
        ) : readOnly ? (
          <h2 className="detail-title detail-title-static">{title.trim() || 'Untitled'}</h2>
        ) : (
          <h2 className="detail-title">
            <button
              type="button"
              className="detail-title-edit"
              onClick={() => setEditing('title')}
              title="Click to edit"
            >
              {title.trim() || 'Untitled'}
            </button>
          </h2>
        )}
      </div>

      {/* Description — big body field, click to edit */}
      {editing === 'summary' ? (
        <textarea
          className="detail-desc-input"
          autoFocus
          rows={6}
          placeholder="Add a description…"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      ) : readOnly ? (
        <div className={`detail-desc detail-desc-static${summary.trim() ? '' : ' detail-desc-empty'}`}>
          {summary.trim() || 'No description.'}
        </div>
      ) : (
        <div
          className={`detail-desc${summary.trim() ? '' : ' detail-desc-empty'}`}
          role="button"
          tabIndex={0}
          onClick={() => setEditing('summary')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setEditing('summary')
            }
          }}
          title="Click to edit"
        >
          {summary.trim() || 'Add a description…'}
        </div>
      )}

      {/* Properties — Notion/Figma-style rows */}
      <div className="detail-props">
        <div className="detail-prop">
          <span className="detail-prop-key">{hasSpan ? 'Start' : 'Date'}</span>
          {editing === 'date' ? (
            <div className="detail-prop-edit">
              <input
                className="detail-prop-input"
                autoFocus
                value={start}
                placeholder='e.g. "2008", "Q3 2008", "2014-03", "49 BCE"'
                onChange={(e) => setStart(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(null)
                  }
                }}
              />
              <span className="detail-hint">→ {formatInstant(parsedStart.instant, parsedStart.precision)}</span>
            </div>
          ) : (
            <button type="button" className="detail-prop-val" onClick={() => !readOnly && setEditing('date')}>
              {formatInstant(parsedStart.instant, parsedStart.precision)}
            </button>
          )}
        </div>

        {hasSpan && (
          <div className="detail-prop">
            <span className="detail-prop-key">End</span>
            {editing === 'end' ? (
              <div className="detail-prop-edit">
                <input
                  className="detail-prop-input"
                  autoFocus
                  value={end}
                  placeholder="optional — blank = ongoing"
                  onChange={(e) => setEnd(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault()
                      setEditing(null)
                    }
                  }}
                />
                {endParsed && <span className="detail-hint">→ {formatInstant(endParsed.instant, endParsed.precision)}</span>}
              </div>
            ) : (
              <button type="button" className={`detail-prop-val${endParsed ? '' : ' detail-prop-empty'}`} onClick={() => !readOnly && setEditing('end')}>
                {endParsed ? formatInstant(endParsed.instant, endParsed.precision) : 'Ongoing'}
              </button>
            )}
          </div>
        )}

        {!readOnly && node.type === 'entity' && (
          <div className="detail-prop">
            <span className="detail-prop-key">Kind</span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {NODE_SUBTYPES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={subtype === s ? 'default' : 'outline'}
                  aria-pressed={subtype === s}
                  className="h-7 px-2.5 text-xs capitalize"
                  onClick={() => setSubtype(s)}
                >
                  {s}
                </Button>
              ))}
              <Button
                size="sm"
                variant={subtype === null ? 'default' : 'outline'}
                aria-pressed={subtype === null}
                className="h-7 px-2.5 text-xs"
                onClick={() => setSubtype(null)}
                title="No specific kind"
              >
                —
              </Button>
            </div>
          </div>
        )}

        {!readOnly && (
          <div className="detail-prop">
            <span className="detail-prop-key">Size</span>
            <div className="flex flex-1 gap-1.5">
              {NODE_SIZES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={size === s ? 'default' : 'outline'}
                  aria-pressed={size === s}
                  className="h-7 flex-1 px-2 text-xs capitalize"
                  onClick={() => setSize(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!readOnly && (
          <div className="detail-prop">
            <span className="detail-prop-key">Color</span>
            <div className="detail-swatches">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`detail-swatch${color === c ? ' detail-swatch-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Set color ${c}`}
                />
              ))}
              <button
                type="button"
                className={`detail-swatch detail-swatch-none${color === null ? ' detail-swatch-active' : ''}`}
                onClick={() => setColor(null)}
                title="Default"
                aria-label="Default color"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="detail-field detail-section">
        <span className="detail-label">Relations</span>
        {relations.length === 0 ? (
          <p className="detail-empty">No relations yet.</p>
        ) : (
          <ul className="detail-relations">
            {relations.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="detail-relation"
                  onClick={() => onSelectNode(r.otherId)}
                  title={`Go to ${r.otherTitle}`}
                >
                  <span className="detail-rel-dir">{r.outgoing ? '→' : '←'}</span>
                  <span className="detail-rel-kind" style={{ color: REL_COLOR[r.kind] }}>
                    {r.label ?? r.kind}
                  </span>
                  <span className="detail-rel-node">{r.otherTitle}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-field detail-section">
        <div className="detail-cite-head">
          <span className="detail-label">Images</span>
          {!readOnly && (
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => imgRef.current?.click()}>
              <Upload />
              Upload
            </Button>
          )}
        </div>
        {!readOnly && (
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
        )}
        {images.length === 0 && (
          <p className="detail-empty">{readOnly ? 'No images.' : 'No images yet — upload your own.'}</p>
        )}
        {images.length > 0 && (
          <div className="detail-images">
            {images.map((im, i) => (
              <div className={`detail-image${im.show ? ' detail-image-shown' : ''}`} key={i}>
                <img className="detail-image-thumb" src={im.url} alt={im.alt ?? 'image'} />
                {im.alt && <span className="detail-image-cap">{im.alt}</span>}
                {!readOnly && (
                  <>
                    <label className="detail-image-show">
                      <input type="checkbox" checked={!!im.show} onChange={() => toggleImage(i)} />
                      Show
                    </label>
                    <Button variant="ghost" size="icon" className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeImage(i)} title="Remove">
                      <X className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="detail-field detail-section">
        <div className="detail-cite-head">
          <span className="detail-label">Citations</span>
          {!readOnly && (
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setCitations((cs) => [...cs, { ...EMPTY_CITATION }])}>
              <Plus />
              Add
            </Button>
          )}
        </div>
        {citations.length === 0 && <p className="detail-empty">No citations yet.</p>}
        {readOnly
          ? citations.map((c, i) => (
              <div className="detail-citation" key={i}>
                <div className="detail-cite-title">{c.title || 'Untitled source'}</div>
                {c.quote?.trim() && <p className="detail-cite-quote">“{c.quote}”</p>}
                {c.url?.trim() && (
                  <a className="detail-cite-link" href={c.url} target="_blank" rel="noreferrer noopener">
                    Open source ↗
                  </a>
                )}
              </div>
            ))
          : citations.map((c, i) => (
              <div className="detail-citation" key={i}>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1"
                    placeholder="Source title"
                    value={c.title}
                    onChange={(e) => updateCitation(i, 'title', e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setCitations((cs) => cs.filter((_, j) => j !== i))}
                    title="Remove citation"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <Input
                  className="h-8"
                  placeholder="URL (optional)"
                  value={c.url ?? ''}
                  onChange={(e) => updateCitation(i, 'url', e.target.value)}
                />
                <Textarea
                  className="min-h-14"
                  rows={2}
                  placeholder="Quote (optional)"
                  value={c.quote ?? ''}
                  onChange={(e) => updateCitation(i, 'quote', e.target.value)}
                />
                {c.url?.trim() && (
                  <a className="detail-cite-link inline-flex items-center gap-1" href={c.url} target="_blank" rel="noreferrer noopener">
                    Open source <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            ))}
      </div>

    </div>
  )
}
