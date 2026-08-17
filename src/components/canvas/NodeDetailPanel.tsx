import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useReactFlow } from '@xyflow/react'
import { ChevronRight, Crosshair, ExternalLink, Loader2, Maximize2, Pencil, Play, Plus, Trash2, Upload, X } from 'lucide-react'
import { centerOnNodes } from './cameraFocus'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { PromptDialog, type PromptSpec } from '~/components/PromptDialog'
import { parseDate, formatInstant, formatInstantRange } from '~/lib/domain/dates'
import { editNode, deleteNode } from '~/lib/server/nodes'
import { capture } from '~/lib/posthog/client'
import { fileToDataUrl } from '~/lib/files'
import { NewStoryDialog } from './NewStoryDialog'
import { NodeVerbBar } from './NodeVerbBar'
import { CitationList } from '~/components/citations/CitationCard'
import { SOURCE_TYPE_LABEL } from '~/lib/domain/citations'
import { ResizeHandle } from './ResizeHandle'
import { GEO_SCOPE_LABELS, IMAGE_ASPECTS, NODE_SIZES, NODE_SUBTYPES } from '~/lib/domain/types'
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

// How each edge kind reads FROM this node. `out` is used when this node is the
// edge's source, `in` when it is the target — so the row is a sentence with this
// node as the implicit subject and needs no arrow to be unambiguous.
const REL_PHRASE: Record<EdgeKind, { out: string; in: string }> = {
  caused: { out: 'caused', in: 'caused by' },
  succeeded: { out: 'succeeded', in: 'succeeded by' },
  influenced: { out: 'influenced', in: 'influenced by' },
  acquired: { out: 'acquired', in: 'acquired by' },
  competed_with: { out: 'competed with', in: 'competed with' },
}

// Kinds where the relationship is mutual, so there is no direction to show.
const SYMMETRIC_KINDS = new Set<EdgeKind>(['competed_with'])

const CITES_COLLAPSED_KEY = 'synek:citations-collapsed'

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
  variant = 'panel',
  storyLabel,
  stories,
  onClose,
  onSelectNode,
  onDraft,
  onPlayStory,
  onAddToGlobe,
  width,
  onResize,
  onCommitResize,
}: {
  node: GraphNode
  edges: GraphEdge[]
  nodes: GraphNode[]
  timelineId: string
  readOnly?: boolean
  // 'panel' (default): the docked canvas side panel (resize handle, focus-on-canvas
  // button, "open full page" expander). 'page': the standalone full-screen entity
  // page (/timelines/$id/nodes/$nodeId) — drops the canvas-only chrome and lays the
  // same content out as a centered responsive reading column. One source of truth
  // for the read/edit form across both surfaces.
  variant?: 'panel' | 'page'
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
  // Owner-only nudge shown on a node that has a `location` string but no map
  // coordinates: opens the globe backfill prompt so the connected Claude can add them.
  onAddToGlobe?: () => void
  // Resizable width (px), owned by the canvas. The panel docks INSIDE the story
  // reader (the reader keeps the flush-right slot), so the canvas clamps this
  // against the reader's width. Omit to leave the CSS default and hide the handle.
  width?: number
  onResize?: (next: number) => void
  onCommitResize?: () => void
}) {
  const qc = useQueryClient()
  const rf = useReactFlow()
  const hasSpan = node.type !== 'event'

  // GAP 3·B — the app holds no AI, so it can't generate a story; instead, a
  // story-less moment offers a ready-made prompt the user pastes into their
  // connected Claude, which writes the story back via the write_story MCP tool.
  // Opens the shared New Story dialog (same one the AppBar uses), pre-anchored to
  // this entity. The app holds no AI, so the dialog hands off a prompt to Claude.
  const [newStoryOpen, setNewStoryOpen] = useState(false)

  // The verb prompt currently shown in the shared PromptDialog (null = closed).
  // Today just "Talk to {name}" (NEXT.5 verb #1 — S3.4); local-66 grows this into
  // a state-gated NodeVerbBar with the full Tier-1 verb set.
  const [promptSpec, setPromptSpec] = useState<PromptSpec | null>(null)
  // Citations collapse. A UI preference, never graph state, so it lives in
  // localStorage beside the other per-device canvas prefs.
  const [citesOpen, setCitesOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(CITES_COLLAPSED_KEY) !== '1'
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(CITES_COLLAPSED_KEY, citesOpen ? '0' : '1')
    } catch {
      // ignore quota / disabled storage
    }
  }, [citesOpen])

  // Edges touching this node, resolved to the other endpoint's title and to a
  // DIRECTIONAL PHRASE. Sorted outgoing-first, then by kind, then by title, so the
  // list has a stable reading order instead of graph load order.
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const relations = edges
    .filter((e) => e.sourceId === node.id || e.targetId === node.id)
    .map((e) => {
      const outgoing = e.sourceId === node.id
      const otherId = outgoing ? e.targetId : e.sourceId
      return {
        id: e.id,
        outgoing,
        kind: e.kind,
        // The phrase reads with THIS node as the implicit subject: "caused X" vs
        // "caused by X". That is the whole fix — the old UI showed a bare ← / →
        // glyph beside the raw kind, which cannot say which way causation runs.
        phrase: REL_PHRASE[e.kind][outgoing ? 'out' : 'in'],
        symmetric: SYMMETRIC_KINDS.has(e.kind),
        // A custom edge label is extra colour, not the relationship itself. It used
        // to REPLACE the kind, which is how "RC 21 May → final 28 Jul" ended up
        // standing in for "succeeded by" next to a contradicting arrow.
        label: e.label,
        otherId,
        otherTitle: nodeById.get(otherId)?.title ?? otherId,
      }
    })
    .sort(
      (a, b) =>
        Number(b.outgoing) - Number(a.outgoing) ||
        a.kind.localeCompare(b.kind) ||
        a.otherTitle.localeCompare(b.otherTitle),
    )

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
  const [location, setLocation] = useState<string>(node.location ?? '')
  const imgRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // The panel is 100% read mode until the explicit Edit button flips it; edit
  // mode mounts every editor at once (a form) and Save/Cancel exit it. The panel
  // is keyed by node id, so this resets on selection change.
  const [isEditing, setIsEditing] = useState(false)
  const storyMode = mode === 'story'
  const isPage = variant === 'page'
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
    // A content edit lands on the shared entity (ADR 0004) — refresh any open
    // entity-page aggregation so its content undo/redo state reflects it.
    void qc.invalidateQueries({ queryKey: ['entityContext'] })
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
            location: location.trim() ? location.trim() : null,
          },
        },
      })
      await refetch()
      capture('node_edited', { timeline_id: timelineId, node_id: node.id })
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

  // `undefined` clears a field (used by the sourceType toggle, which deselects).
  function updateCitation<K extends keyof CanvasCitation>(i: number, field: K, value: CanvasCitation[K]) {
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
    (location.trim() ? location.trim() : null) !== (node.location ?? null) ||
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
    setLocation(node.location ?? '')
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
    <div className={isPage ? 'detail-panel node-page' : 'detail-panel'} role="dialog" aria-label="Node details">
      {!isPage && width != null && onResize && (
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
          {!storyMode && !isPage && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => centerOnNodes(rf, [node.id], { duration: 400 })}
                aria-label="Focus on canvas"
                title="Focus on canvas"
              >
                <Crosshair className="size-4" />
              </Button>
              {/* Open this entity on its own full-screen page (decoupled from the
                  canvas) — the docked panel and the page share this component. */}
              <Button asChild variant="ghost" size="icon" className="size-7">
                <Link
                  to="/timelines/$id/nodes/$nodeId"
                  params={{ id: timelineId, nodeId: node.id }}
                  data-testid="open-node-page"
                  aria-label="Open full page"
                  title="Open full page"
                >
                  <Maximize2 className="size-4" />
                </Link>
              </Button>
            </>
          )}
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
                  <img className="detail-image-photo" src={im.url} alt={im.alt ?? 'image'} width={168} height={im.aspect === 'portrait' ? 224 : 150} />
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
            name="title"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Birth of the Internet…"
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
          {node.location ? (
            <>
              <span className="detail-dateline-sep"> · </span>
              <span>{node.location}</span>
            </>
          ) : node.geoScope ? (
            // Reviewed-and-unpinnable: explain the absence of a place instead of
            // rendering nothing ("Worldwide — no single place" / "Location unknown").
            <>
              <span className="detail-dateline-sep"> · </span>
              <span>{GEO_SCOPE_LABELS[node.geoScope]}</span>
            </>
          ) : null}
          {canEdit && onAddToGlobe && node.location && (node.lat == null || node.lng == null) && !node.geoScope && (
            <>
              <span className="detail-dateline-sep"> · </span>
              <button type="button" className="detail-add-to-globe" onClick={onAddToGlobe}>
                Add to globe →
              </button>
            </>
          )}
        </p>
      )}

      {/* Verb action row — NEXT.5 Tier 1 (docs/product/prd/next5-verb-system.md).
          The verbs that apply to this node, from the shared registry, type/state
          gated. Owner-only, read mode. 'write-story' is excluded here because the
          dedicated Story section is rendered further down. */}
      {canEdit && !editMode && (
        <NodeVerbBar
          node={node}
          ctx={{ timelineId, surface: 'node_panel' }}
          onRun={setPromptSpec}
          exclude={['write-story']}
        >
          {/* "New story" lives HERE, beside "Expand around this", so every action
              on a node is in one row. It used to sit alone in the Story section
              further down AND only when the moment had no stories yet — which
              also meant there was no way to add a second story from the panel. */}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setNewStoryOpen(true)}>
            <Plus className="size-4" />
            New story
          </Button>
        </NodeVerbBar>
      )}

      {/* Description — body field, clamped to a few lines with Show more.
          Hidden entirely when blank in read mode. */}
      {editMode ? (
        <textarea
          className="detail-desc-input"
          name="description"
          autoComplete="off"
          rows={6}
          placeholder="e.g. Add a description of this event or entity…"
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
                name="startInstant"
                autoComplete="off"
                value={start}
                placeholder='e.g. “2008”, “Q3 2008”, “2014-03”, “49 BCE”…'
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
                  name="endInstant"
                  autoComplete="off"
                  value={end}
                  placeholder="e.g. Q3 2008 or blank…"
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
                name="lane"
                autoComplete="off"
                placeholder="e.g. a company / track or blank…"
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
            <span className="detail-prop-key">Location</span>
            <div className="detail-prop-edit">
              <Input
                className="h-7 text-xs"
                name="location"
                autoComplete="off"
                placeholder="e.g. Golgotha, Jerusalem…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                aria-label="Location"
              />
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
                  data-dir={r.symmetric ? 'both' : r.outgoing ? 'out' : 'in'}
                  onClick={() => onSelectNode(r.otherId)}
                  // Reads as the full sentence for a screen reader, which the old
                  // "Go to X" title never conveyed.
                  aria-label={`${node.title} ${r.phrase} ${r.otherTitle}. Open ${r.otherTitle}.`}
                >
                  <span className="detail-rel-phrase" style={{ color: REL_COLOR[r.kind] }}>
                    {r.phrase}
                  </span>
                  <span className="detail-rel-node">{r.otherTitle}</span>
                  {r.label && <span className="detail-rel-label">{r.label}</span>}
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

      {/* Verb prompt dialog (shared swap-seam). The panel is a docked div, not a
          Radix modal, so opening this modal from it needs no close-sequencing
          dance (unlike ⌘K). */}
      <PromptDialog
        open={!!promptSpec}
        onOpenChange={(next) => {
          if (!next) setPromptSpec(null)
        }}
        spec={promptSpec}
      />

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
                  name={`citeTitle-${i}`}
                  autoComplete="off"
                  placeholder="e.g. Wikipedia…"
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
                name={`citeUrl-${i}`}
                autoComplete="off"
                placeholder="e.g. https://example.com/source…"
                value={c.url ?? ''}
                onChange={(e) => updateCitation(i, 'url', e.target.value)}
              />
              <Textarea
                className="min-h-14"
                rows={2}
                name={`citeQuote-${i}`}
                autoComplete="off"
                placeholder="e.g. The first message was sent…"
                value={c.quote ?? ''}
                onChange={(e) => updateCitation(i, 'quote', e.target.value)}
              />
              {/* Source genre. Previously absent from this form AND stripped by the
                  server's Zod, so an MCP-set value was destroyed on the first save. */}
              <div className="detail-cite-types" role="group" aria-label="Source type">
                {(Object.keys(SOURCE_TYPE_LABEL) as (keyof typeof SOURCE_TYPE_LABEL)[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="detail-cite-type"
                    aria-pressed={c.sourceType === t}
                    onClick={() => updateCitation(i, 'sourceType', c.sourceType === t ? undefined : t)}
                  >
                    {SOURCE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
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
        // Collapsible: on a well-sourced node the citation stack is the longest
        // thing in the panel and pushes relations and stories off the scroll.
        // Open by default (sourcing is the product's point), remembered per device.
        <div className="detail-field detail-section">
          <button
            type="button"
            className="detail-section-toggle"
            aria-expanded={citesOpen}
            aria-controls="detail-citations"
            onClick={() => setCitesOpen((v) => !v)}
          >
            <ChevronRight className="detail-section-chevron" aria-hidden="true" />
            <span className="detail-label">Citations</span>
            <span className="detail-section-count">{citations.length}</span>
          </button>
          {citesOpen && <CitationList citations={citations} id="detail-citations" className="detail-cites" />}
        </div>
      ) : null}

    </div>
  )
}
