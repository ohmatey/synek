import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Pencil, Play, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { parseDate, formatInstant, formatInstantRange } from '~/lib/domain/dates'
import { editNode, deleteNode } from '~/lib/server/nodes'
import { fileToDataUrl } from '~/lib/files'
import { NewStoryDialog } from './NewStoryDialog'
import { ResizeHandle } from './ResizeHandle'
import { IMAGE_ASPECTS, NODE_SIZES, NODE_SUBTYPES } from '~/lib/domain/types'
import type { GraphNode, GraphEdge, CanvasCitation, ImageAspect, NodeImage, NodeSize, NodeSubtype, Precision, EdgeKind, PovType, StoryListItem } from '~/lib/domain/types'
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
  mode = 'default',
  storyLabel,
  stories,
  onClose,
  onSelectNode,
  onDraft,
  onPlayStory,
  width,
  onResize,
  onCommitResize,
}: {
  node: GraphNode
  edges: GraphEdge[]
  nodes: GraphNode[]
  timelineId: string
  readOnly?: boolean
  // 'story': the panel is the portrait beside the docked reader — the entity a
  // beat focuses on. Strips down to images / title / dates / description with a
  // "Story · {storyLabel}" eyebrow; no relations, stories, citations, or editing.
  mode?: 'default' | 'story'
  storyLabel?: string
  // The stories attached to this moment (passed from the canvas, which owns the
  // query). A moment can hold several. undefined while loading, [] when there are
  // none. Ignored in story mode.
  stories?: StoryListItem[]
  onClose: () => void
  onSelectNode: (id: string) => void
  onDraft: (draft: NodeDraft | null) => void
  // Open the docked story reader beside this panel on a specific story (only
  // meaningful on the moment).
  onPlayStory?: (storyId: string) => void
  // Resizable width (px), owned by the canvas so the story reader can dock to
  // its left edge. Omit to leave the CSS default and hide the drag handle.
  width?: number
  onResize?: (next: number) => void
  onCommitResize?: () => void
}) {
  const qc = useQueryClient()
  const hasSpan = node.type !== 'event'

  // GAP 3·B — the app holds no AI, so it can't generate a story; instead, a
  // story-less moment offers a ready-made prompt the user pastes into their
  // connected Claude, which writes the story back via the write_story MCP tool.
  // Opens the shared New Story dialog (same one the AppBar uses), pre-anchored to
  // this entity. The app holds no AI, so the dialog hands off a prompt to Claude.
  const [newStoryOpen, setNewStoryOpen] = useState(false)

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
  // The panel is 100% read mode until the explicit Edit button flips it; edit
  // mode mounts every editor at once (a form) and Save/Cancel exit it. The panel
  // is keyed by node id, so this resets on selection change.
  const [isEditing, setIsEditing] = useState(false)
  const storyMode = mode === 'story'
  const canEdit = !readOnly && !storyMode
  const editMode = canEdit && isEditing
  // Long descriptions clamp to a few lines (read-first); "Show more" expands.
  // `descOverflows` gates the toggle — only shown when the text is actually
  // taller than the clamp.
  const descRef = useRef<HTMLDivElement | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descOverflows, setDescOverflows] = useState(false)

  const parsedStart = parseDate(start)

  // Live preview: publish in-progress edits so the canvas reflects them without
  // persisting. Save commits them; canceling re-publishes the persisted values
  // (reset() reruns this effect), so the canvas reverts. Don't gate this on
  // editMode — the revert republish depends on it running after a cancel.
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
  // would falsely clear it) or in edit mode (the textarea is mounted instead),
  // so descOverflows sticks true through an expand.
  useEffect(() => {
    if (descExpanded || editMode) return
    const el = descRef.current
    setDescOverflows(!!el && el.scrollHeight - el.clientHeight > 1)
  }, [summary, descExpanded, editMode])

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
      setIsEditing(false)
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

  function addCitation() {
    setCitations((cs) => [...cs, { ...EMPTY_CITATION }])
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

  // Dirty = some field diverges from the persisted node. Gates the Save button
  // in edit mode: a freshly entered edit mode reads clean until something changes.
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

  // Discard local edits, reverting every field to the persisted node. The next
  // onDraft effect run republishes the persisted values, so the canvas reverts.
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
  }

  function cancel() {
    reset()
    setIsEditing(false)
  }

  // One readable line for the node's time + kind, e.g.
  // "Company · Jun 1997 – Jul 2007 · 10 years". Replaces the prop rows in read
  // mode; the canvas-presentation knobs (Size/Lane/Color) live in edit mode only.
  const dateline = formatInstantRange(node.startInstant, hasSpan ? node.endInstant : null, node.precision, hasSpan)

  return (
    <div className="detail-panel" role="dialog" aria-label="Node details">
      {width != null && onResize && (
        <ResizeHandle width={width} onResize={onResize} onCommit={onCommitResize} label="Resize details panel" />
      )}
      <header className="detail-head">
        {canEdit && (
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
        {storyMode && storyLabel && (
          <span className="detail-preview-eyebrow" title={`Reading: ${storyLabel}`}>
            Story · {storyLabel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {editMode ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-muted-foreground"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-7 px-3" onClick={save} disabled={busy || !dirty}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                data-testid="edit-node"
                onClick={() => setIsEditing(true)}
                aria-label="Edit"
                title="Edit"
              >
                <Pencil className="size-4" />
              </Button>
            )
          )}
          <Button variant="ghost" size="icon" className="-mr-1 size-7" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </header>

      {/* Images — hero strip at the top (Notion-style cover). Multiple images
          scroll horizontally like a place card, putting the face of the moment
          first. Hidden entirely when empty in read mode; edit mode always shows
          the strip with its management controls (manual Upload, no AI). */}
      {(images.length > 0 || editMode) && (
        <div className="detail-hero">
          {editMode && (
            <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
          )}
          {images.length > 0 && (
            <div className={`detail-image-strip${editMode ? ' detail-image-strip-editing' : ''}`} role="list">
              {images.map((im, i) => (
                <figure
                  className={`detail-image-card${im.aspect === 'portrait' ? ' detail-image-portrait' : ''}${im.show ? ' detail-image-shown' : ''}`}
                  key={i}
                  role="listitem"
                >
                  <img className="detail-image-photo" src={im.url} alt={im.alt ?? 'image'} />
                  {im.alt && <figcaption className="detail-image-cap">{im.alt}</figcaption>}
                  {editMode && (
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
          {editMode && (
            <div className="detail-hero-actions">
              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => imgRef.current?.click()}>
                <Upload />
                {images.length === 0 ? 'Add images' : 'Upload'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Title — doc heading */}
      <div className="detail-title-row">
        {editMode ? (
          <input
            className="detail-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Title"
          />
        ) : (
          <h2 className="detail-title detail-title-static">{title.trim() || 'Untitled'}</h2>
        )}
      </div>

      {/* Read mode tells the time as one line under the title (kind folded in)
          instead of a settings-style grid of property rows. */}
      {!editMode && (
        <p className="detail-dateline">
          {node.subtype && (
            <>
              <span className="capitalize">{node.subtype}</span>
              <span className="detail-dateline-sep"> · </span>
            </>
          )}
          {dateline}
        </p>
      )}

      {/* Description — body field, clamped to a few lines with Show more.
          Hidden entirely when blank in read mode. */}
      {editMode ? (
        <textarea
          className="detail-desc-input"
          rows={6}
          placeholder="Add a description…"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-label="Description"
        />
      ) : summary.trim() ? (
        <div className="detail-desc-block">
          <div ref={descRef} className={`detail-desc detail-desc-static${descExpanded ? '' : ' detail-desc-clamp'}`}>
            {summary}
          </div>
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
      ) : null}

      {/* Properties — Notion/Figma-style rows; edit mode only, all editors open */}
      {editMode && (
        <div className="detail-props">
          <div className="detail-prop">
            <span className="detail-prop-key">{hasSpan ? 'Start' : 'Date'}</span>
            <div className="detail-prop-edit">
              <input
                className="detail-prop-input"
                value={start}
                placeholder='e.g. "2008", "Q3 2008", "2014-03", "49 BCE"'
                onChange={(e) => setStart(e.target.value)}
                aria-label={hasSpan ? 'Start date' : 'Date'}
              />
              <span className="detail-hint">→ {formatInstant(parsedStart.instant, parsedStart.precision)}</span>
            </div>
          </div>

          {hasSpan && (
            <div className="detail-prop">
              <span className="detail-prop-key">End</span>
              <div className="detail-prop-edit">
                <input
                  className="detail-prop-input"
                  value={end}
                  placeholder="optional — blank = ongoing"
                  onChange={(e) => setEnd(e.target.value)}
                  aria-label="End date"
                />
                {endParsed && <span className="detail-hint">→ {formatInstant(endParsed.instant, endParsed.precision)}</span>}
              </div>
            </div>
          )}

          {node.type === 'entity' && (
            <div className="detail-prop">
              <span className="detail-prop-key">Kind</span>
              <div className="detail-prop-pick">
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

          <div className="detail-prop">
            <span className="detail-prop-key">Size</span>
            <div className="detail-prop-pick">
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

          <div className="detail-prop">
            <span className="detail-prop-key">Lane</span>
            <div className="detail-prop-edit">
              <Input
                className="h-7 text-xs"
                placeholder="Swimlane — e.g. a company / track (blank = by type)"
                value={lane}
                onChange={(e) => setLane(e.target.value)}
                list="synek-lane-options"
                aria-label="Lane"
              />
              {/* Suggest lanes already in use elsewhere on this timeline. */}
              <datalist id="synek-lane-options">
                {Array.from(new Set(nodes.map((n) => n.lane).filter((l): l is string => !!l))).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
          </div>

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
        </div>
      )}

      {/* Relations — hidden when empty, and in story mode (jumping to another
          node mid-story would tear down the reading session). */}
      {!storyMode && relations.length > 0 && (
        <div className="detail-field detail-section">
          <span className="detail-label">Relations</span>
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
        </div>
      )}

      {!storyMode && stories && stories.length > 0 && (
        <div className="detail-field detail-section detail-story">
          <span className="detail-label">
            {stories.length === 1 ? 'Story' : `Stories · ${stories.length}`}
          </span>
          {/* A moment can hold several stories — list them compactly; the full
              readable text plays beat-by-beat in the docked reader (Play). */}
          <ul className="detail-story-list">
            {stories.map((s) => (
              <li
                key={s.storyId}
                className={`detail-story-row${s.depthTier === 'deep' ? ' detail-story-deep' : ''}`}
              >
                <h3 className="detail-story-title">{s.title}</h3>
                {s.hook && <p className="detail-story-hook">{s.hook}</p>}
                <div className="detail-story-meta">
                  <span className={`detail-story-tier${s.depthTier === 'deep' ? ' detail-story-tier-deep' : ''}`}>
                    {s.depthTier === 'deep' ? 'Deep' : 'Light'}
                  </span>
                  {s.povType !== 'omniscient' && <span className="detail-story-pov">{POV_LABEL[s.povType]}</span>}
                  {s.estimatedMinutes != null && <span className="detail-story-mins">~{s.estimatedMinutes} min</span>}
                  <span className="detail-story-beatcount">
                    {s.beatCount} {s.beatCount === 1 ? 'beat' : 'beats'}
                  </span>
                </div>
                {/* Open the docked, stepped reader on this story (cover first). */}
                <Button
                  className="detail-story-play"
                  onClick={() => onPlayStory?.(s.storyId)}
                  disabled={s.beatCount === 0}
                >
                  <Play className="size-4" />
                  Play story
                </Button>
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button variant="outline" className="detail-story-play" onClick={() => setNewStoryOpen(true)}>
              <Plus className="size-4" />
              Add another story
            </Button>
          )}
        </div>
      )}

      {!storyMode && stories && stories.length === 0 && canEdit && (
        <div className="detail-field detail-section detail-story-ask">
          <span className="detail-label">Story</span>
          <Button className="detail-story-play" onClick={() => setNewStoryOpen(true)}>
            <Plus className="size-4" />
            New story
          </Button>
          <p className="detail-hint">
            Opens the New Story dialog — pick the cast and copy a prompt for your connected Claude, which writes a
            grounded story onto this moment. It appears here as a tap-through story you can play.
          </p>
        </div>
      )}

      {canEdit && (
        <NewStoryDialog
          open={newStoryOpen}
          onOpenChange={setNewStoryOpen}
          timelineId={timelineId}
          nodes={nodes.map((n) => ({ id: n.id, title: n.title, type: n.type }))}
          initialAnchorId={node.id}
        />
      )}

      {/* Citations — read mode shows them only when present; the editor (with
          Add) is part of edit mode. */}
      {editMode ? (
        <div className="detail-field detail-section">
          <span className="detail-label">Citations</span>
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
          <Button variant="outline" size="sm" className="h-7 self-start px-2.5 text-xs" data-testid="add-citation" onClick={addCitation}>
            <Plus />
            Add
          </Button>
        </div>
      ) : !storyMode && citations.length > 0 ? (
        <div className="detail-field detail-section">
          <span className="detail-label">Citations</span>
          {citations.map((c, i) => (
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
      ) : null}

    </div>
  )
}
