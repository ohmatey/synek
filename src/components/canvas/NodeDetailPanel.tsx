import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Pencil, Play, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { parseDate, formatInstant } from '~/lib/domain/dates'
import { editNode, deleteNode } from '~/lib/server/nodes'
import { fileToDataUrl } from '~/lib/files'
import { CopyButton } from '~/components/home/CopyButton'
import { IMAGE_ASPECTS, NODE_SIZES, NODE_SUBTYPES } from '~/lib/domain/types'
import type { GraphNode, GraphEdge, CanvasCitation, ImageAspect, NodeImage, NodeSize, NodeSubtype, NodeType, Precision, EdgeKind, PovType, StoryDTO } from '~/lib/domain/types'
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

// Human labels for the story POV. Only surfaced when it's NOT the S1 default
// ('omniscient') — showing "Omniscient" on every story is noise, but the moment a
// client passes a real vantage (witness/first-person/diary) the reader names it.
const POV_LABEL: Record<PovType, string> = {
  omniscient: 'Omniscient',
  first_person: 'First person',
  witness: 'Witness',
  diary: 'Diary',
}

export function NodeDetailPanel({
  node,
  edges,
  nodes,
  timelineId,
  readOnly = false,
  preview = false,
  previewLabel,
  story,
  onClose,
  onSelectNode,
  onDraft,
  onPlayStory,
}: {
  node: GraphNode
  edges: GraphEdge[]
  nodes: GraphNode[]
  timelineId: string
  readOnly?: boolean
  // When true, this panel is a read-only preview of the entity a story beat focuses
  // on (the docked reader is the story surface): no story section, ask block, or
  // edit affordances — just the entity, with a "Story · {previewLabel}" eyebrow.
  preview?: boolean
  previewLabel?: string
  // The story attached to this moment (passed from the canvas, which owns the
  // query). undefined while loading, null when there's none. Ignored in preview.
  story?: StoryDTO | null
  onClose: () => void
  onSelectNode: (id: string) => void
  onDraft: (draft: NodeDraft | null) => void
  // Open the docked story reader beside this panel (only meaningful on the moment).
  onPlayStory?: () => void
}) {
  const qc = useQueryClient()
  const hasSpan = node.type !== 'event'
  const beatCount = story?.beats.length ?? 0

  // GAP 3·B — the app holds no AI, so it can't generate a story; instead, a
  // story-less moment offers a ready-made prompt the user pastes into their
  // connected Claude, which writes the story back via the write_story MCP tool.
  const askPrompt =
    `Using the Synek MCP tools, write a short, source-grounded story onto this moment with write_story.\n` +
    `- momentId: ${node.id}\n` +
    `- timelineId: ${timelineId}\n` +
    `- moment: "${node.title}"\n` +
    `Use 3–5 beats. Ground every factual beat with a real citation (title + url + a short verbatim quote). Keep it readable and faithful to what actually happened.`

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
  const [lane, setLane] = useState<string>(node.lane ?? '')
  const imgRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // Read-first: the panel opens as a clean view; clicking a field reveals its
  // editor. Only one inline editor is open at a time (`editing`); the two list
  // sections (citations, images) toggle their own editors independently.
  const [editing, setEditing] = useState<
    'title' | 'summary' | 'date' | 'end' | 'kind' | 'size' | 'color' | 'lane' | null
  >(null)
  const [editCitations, setEditCitations] = useState(false)
  const [editImages, setEditImages] = useState(false)
  // Long descriptions clamp to a few lines (read-first); "Show more" expands.
  // `descOverflows` gates the toggle — only shown when the text is actually
  // taller than the clamp. The panel is keyed by node id, so these reset on
  // selection change.
  const descRef = useRef<HTMLDivElement | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descOverflows, setDescOverflows] = useState(false)

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

  // Measure whether the clamped description overflows so the toggle only appears
  // when there's more to show. Skip while expanded (clientHeight==scrollHeight
  // would falsely clear it) or while editing (the textarea is mounted instead),
  // so descOverflows sticks true through an expand.
  useEffect(() => {
    if (descExpanded || editing === 'summary') return
    const el = descRef.current
    setDescOverflows(!!el && el.scrollHeight - el.clientHeight > 1)
  }, [summary, descExpanded, editing])

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
            lane: lane.trim() ? lane.trim() : null,
          },
        },
      })
      await refetch()
      setEditing(null)
      setEditCitations(false)
      setEditImages(false)
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

  // Open the citations editor and append a blank row in one gesture (the section
  // head's "Add" when there are none yet, plus the in-editor "Add").
  function addCitation() {
    setCitations((cs) => [...cs, { ...EMPTY_CITATION }])
    setEditCitations(true)
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

  function setImageAspect(i: number, aspect: ImageAspect) {
    setImages((xs) => xs.map((im, j) => (j === i ? { ...im, aspect } : im)))
  }

  function removeImage(i: number) {
    setImages((xs) => xs.filter((_, j) => j !== i))
  }

  const endParsed = end.trim() ? parseDate(end) : null

  // Dirty = some field diverges from the persisted node. Drives the view-first
  // Save/Discard affordances: a freshly opened node reads as a clean view with no
  // Save button until an edit actually changes something.
  const cleanCitations = citations.filter((c) => c.title.trim())
  const dirty =
    (title.trim() || node.title) !== node.title ||
    (summary.trim() ? summary : null) !== (node.summary ?? null) ||
    parsedStart.instant !== node.startInstant ||
    parsedStart.precision !== node.precision ||
    (hasSpan ? (endParsed ? endParsed.instant : null) : node.endInstant) !== node.endInstant ||
    size !== node.size ||
    color !== node.color ||
    subtype !== node.subtype ||
    (lane.trim() ? lane.trim() : null) !== (node.lane ?? null) ||
    JSON.stringify(cleanCitations) !== JSON.stringify(node.citations) ||
    JSON.stringify(images) !== JSON.stringify(node.images)

  // Discard local edits, reverting every field to the persisted node + closing
  // any open inline editor.
  function reset() {
    setTitle(node.title)
    setSummary(node.summary ?? '')
    setStart(toInputDate(node.startInstant, node.precision))
    setEnd(node.endInstant != null ? toInputDate(node.endInstant, node.precision) : '')
    setCitations(node.citations)
    setImages(node.images)
    setSize(node.size)
    setColor(node.color)
    setSubtype(node.subtype)
    setLane(node.lane ?? '')
    setEditing(null)
    setEditCitations(false)
    setEditImages(false)
  }

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
        {preview && previewLabel && (
          <span className="detail-preview-eyebrow" title={`Reading: ${previewLabel}`}>
            Story · {previewLabel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!readOnly && dirty && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-muted-foreground"
                onClick={reset}
                disabled={busy}
              >
                Discard
              </Button>
              <Button size="sm" className="h-7 px-3" onClick={save} disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="-mr-1 size-7" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </header>

      {/* Images — hero strip at the top (Notion-style cover). Multiple images
          scroll horizontally like a place card, putting the face of the moment
          first. Editing controls fold in behind the Edit affordance. */}
      {(images.length > 0 || !readOnly) && (
        <div className="detail-hero">
          {!readOnly && (
            <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
          )}
          {images.length > 0 && (
            <div className={`detail-image-strip${editImages ? ' detail-image-strip-editing' : ''}`} role="list">
              {images.map((im, i) => (
                <figure
                  className={`detail-image-card${im.aspect === 'portrait' ? ' detail-image-portrait' : ''}${im.show ? ' detail-image-shown' : ''}`}
                  key={i}
                  role="listitem"
                >
                  <img className="detail-image-photo" src={im.url} alt={im.alt ?? 'image'} />
                  {im.alt && <figcaption className="detail-image-cap">{im.alt}</figcaption>}
                  {editImages && !readOnly && (
                    <>
                      <div className="detail-image-aspect" role="group" aria-label="Image orientation">
                        {IMAGE_ASPECTS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={`detail-image-aspect-btn${(im.aspect ?? 'landscape') === a ? ' detail-image-aspect-active' : ''}`}
                            aria-pressed={(im.aspect ?? 'landscape') === a}
                            onClick={() => setImageAspect(i, a)}
                          >
                            {a === 'portrait' ? 'Portrait' : 'Landscape'}
                          </button>
                        ))}
                      </div>
                      <div className="detail-image-controls">
                        <label className="detail-image-show">
                          <input type="checkbox" checked={!!im.show} onChange={() => toggleImage(i)} />
                          Show on canvas
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeImage(i)}
                          title="Remove"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </figure>
              ))}
            </div>
          )}
          {!readOnly && (
            <div className="detail-hero-actions">
              {editImages ? (
                <>
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => imgRef.current?.click()}>
                    <Upload />
                    Upload
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => setEditImages(false)}>
                    Done
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-xs text-muted-foreground"
                  data-testid="edit-images"
                  onClick={() => setEditImages(true)}
                >
                  {images.length === 0 ? <Upload /> : <Pencil />}
                  {images.length === 0 ? 'Add images' : 'Edit images'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

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

      {/* Description — body field, clamped to a few lines with Show more; click to edit */}
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
      ) : (
        <div className="detail-desc-block">
          {readOnly ? (
            <div
              ref={descRef}
              className={`detail-desc detail-desc-static${summary.trim() ? '' : ' detail-desc-empty'}${descExpanded ? '' : ' detail-desc-clamp'}`}
            >
              {summary.trim() || 'No description.'}
            </div>
          ) : (
            <div
              ref={descRef}
              className={`detail-desc${summary.trim() ? '' : ' detail-desc-empty'}${descExpanded ? '' : ' detail-desc-clamp'}`}
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
          {(descOverflows || descExpanded) && (
            <button
              type="button"
              className="detail-desc-toggle"
              onClick={() => setDescExpanded((v) => !v)}
            >
              {descExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
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
            {editing === 'kind' ? (
              <div
                className="detail-prop-pick"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(null)
                }}
              >
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
            ) : (
              <button
                type="button"
                data-testid="edit-kind"
                className={`detail-prop-val capitalize${subtype ? '' : ' detail-prop-empty'}`}
                onClick={() => setEditing('kind')}
              >
                {subtype ?? 'Unspecified'}
              </button>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="detail-prop">
            <span className="detail-prop-key">Size</span>
            {editing === 'size' ? (
              <div
                className="detail-prop-pick"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(null)
                }}
              >
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
            ) : (
              <button type="button" className="detail-prop-val capitalize" onClick={() => setEditing('size')}>
                {size}
              </button>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="detail-prop">
            <span className="detail-prop-key">Lane</span>
            {editing === 'lane' ? (
              <div className="detail-prop-edit">
                <Input
                  className="h-7 text-xs"
                  autoFocus
                  placeholder="Swimlane — e.g. a company / track (blank = by type)"
                  value={lane}
                  onChange={(e) => setLane(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault()
                      setEditing(null)
                    }
                  }}
                  list="synek-lane-options"
                />
                {/* Suggest lanes already in use elsewhere on this timeline. */}
                <datalist id="synek-lane-options">
                  {Array.from(new Set(nodes.map((n) => n.lane).filter((l): l is string => !!l))).map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>
            ) : (
              <button
                type="button"
                className={`detail-prop-val${lane.trim() ? '' : ' detail-prop-empty'}`}
                onClick={() => setEditing('lane')}
              >
                {lane.trim() ? lane : 'By type'}
              </button>
            )}
          </div>
        )}

        {readOnly && node.lane && (
          <div className="detail-prop">
            <span className="detail-prop-key">Lane</span>
            <span className="detail-prop-val">{node.lane}</span>
          </div>
        )}

        {!readOnly && (
          <div className="detail-prop">
            <span className="detail-prop-key">Color</span>
            {editing === 'color' ? (
              <div
                className="detail-swatches"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(null)
                }}
              >
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
            ) : (
              <button
                type="button"
                className="detail-prop-val detail-color-val"
                onClick={() => setEditing('color')}
              >
                <span className="detail-color-dot" style={{ background: color ?? 'var(--color-fg-subtle)' }} />
                {color ?? 'Default'}
              </button>
            )}
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

      {!preview && story && (
        <div className={`detail-field detail-section detail-story${story.depthTier === 'deep' ? ' detail-story-deep' : ''}`}>
          <span className="detail-label">Story</span>
          <h3 className="detail-story-title">{story.title}</h3>
          {story.hook && <p className="detail-story-hook">{story.hook}</p>}
          <div className="detail-story-meta">
            <span className={`detail-story-tier${story.depthTier === 'deep' ? ' detail-story-tier-deep' : ''}`}>
              {story.depthTier === 'deep' ? 'Deep' : 'Light'}
            </span>
            {story.povType !== 'omniscient' && <span className="detail-story-pov">{POV_LABEL[story.povType]}</span>}
            {story.estimatedMinutes != null && <span className="detail-story-mins">~{story.estimatedMinutes} min</span>}
            <span className="detail-story-beatcount">
              {beatCount} {beatCount === 1 ? 'beat' : 'beats'}
            </span>
          </div>
          {/* Headline action: open the docked, stepped story reader beside this panel. */}
          <Button className="detail-story-play" onClick={() => onPlayStory?.()} disabled={beatCount === 0}>
            <Play className="size-4" />
            Play story
          </Button>
          {/* Static, readable beat list (in-panel reading + grounding). The
              immersive, stepped tap-through lives in StoryReader (docked alongside). */}
          <ol className="detail-story-beats">
            {story.beats.map((b) => (
              <li key={b.id} className={`detail-story-beat detail-story-${b.kind}`}>
                {b.settingNote && <span className="detail-story-setting">{b.settingNote}</span>}
                <p className="detail-story-text">{b.bodyText}</p>
                {b.relatedNodeIds.length > 0 && (
                  <div className="detail-story-links">
                    {b.relatedNodeIds.map((id) => {
                      const other = nodeById.get(id)
                      if (!other) return null
                      return (
                        <button
                          key={id}
                          type="button"
                          className="detail-story-link"
                          onClick={() => onSelectNode(id)}
                          title={`Go to ${other.title}`}
                        >
                          → {other.title}
                        </button>
                      )
                    })}
                  </div>
                )}
                {b.citations.length > 0 && (
                  <div className="detail-story-cites">
                    {b.citations.map((c, i) => (
                      <div className="detail-citation" key={i}>
                        <div className="detail-cite-title">{c.title || 'Untitled source'}</div>
                        {c.quote?.trim() && <p className="detail-cite-quote">“{c.quote}”</p>}
                        {c.url?.trim() && (
                          <a className="detail-cite-link" href={c.url} target="_blank" rel="noreferrer noopener">
                            Open source ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!preview && story === null && !readOnly && (
        <div className="detail-field detail-section detail-story-ask">
          <span className="detail-label">Story</span>
          <p className="detail-empty">No story on this moment yet.</p>
          <CopyButton
            text={askPrompt}
            label="Generate a story with Claude"
            copiedLabel="Prompt copied — paste into Claude"
          />
          <p className="detail-hint">
            Copies a prompt; paste it into your connected Claude to generate a grounded story onto this moment. It
            appears here as a tap-through story you can play.
          </p>
        </div>
      )}

      <div className="detail-field detail-section">
        <div className="detail-cite-head">
          <span className="detail-label">Citations</span>
          {!readOnly &&
            (editCitations ? (
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setEditCitations(false)}>
                Done
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                data-testid="edit-citations"
                onClick={() => (citations.length ? setEditCitations(true) : addCitation())}
              >
                {citations.length ? <Pencil /> : <Plus />}
                {citations.length ? 'Edit' : 'Add'}
              </Button>
            ))}
        </div>
        {!editCitations || readOnly ? (
          citations.length === 0 ? (
            <p className="detail-empty">No citations yet.</p>
          ) : (
            citations.map((c, i) => (
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
          )
        ) : (
          <>
            {citations.map((c, i) => (
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
            <Button variant="outline" size="sm" className="h-7 self-start px-2.5 text-xs" onClick={addCitation}>
              <Plus />
              Add
            </Button>
          </>
        )}
      </div>

    </div>
  )
}
