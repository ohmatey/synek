import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { parseDate } from '~/lib/domain/dates'
import type { PatchBuilder, NodePatch, EdgePatch } from '~/lib/db/patches'
import { commitEntityPatch, type EntityContentPatch } from '~/lib/db/entity-patches'
import { entities, type NodeMetadata } from '~/lib/db/schema'
import { GEO_SCOPES, type NodeImage, type Precision } from '~/lib/domain/types'

// Transport-agnostic graph-edit logic. Lifted out of the old AI-SDK `tools.ts`
// so the SAME op semantics back the MCP server. A batch of ops runs through one
// PatchBuilder and commits as one atomic, undoable Patch upstream.

const citation = z.object({
  title: z.string(),
  url: z
    .string()
    .optional()
    .describe(
      'Stable public link to the source (Wikipedia, archive.org, a publisher page) — add one wherever it exists; ' +
        'keep title-only for print sources. Never invent a URL you have not seen.',
    ),
  quote: z.string().optional().describe('Short verbatim quote from the source backing the claim.'),
  sourceType: z
    .enum(['primary', 'scholarship', 'data', 'press'])
    .optional()
    .describe(
      'What kind of source: "primary" (a document/witness from the period), "scholarship" (academic or trade ' +
        'analysis), "data" (datasets, statistics), "press" (journalism). Lets readers weigh sources at a glance.',
    ),
})

const dateHint = 'A date, possibly fuzzy: "1995", "Q3 2008", "2014-03", or "49 BCE".'
const precisionEnum = z.enum(['year', 'quarter', 'month', 'day'])
const kindEnum = z.enum(['caused', 'succeeded', 'influenced', 'acquired', 'competed_with'])
const kindHint =
  'Direction matters — the arrow reads "<source> <kind> <target>": A caused B (A is the origin), ' +
  'A influenced B (influence flows A→B), A succeeded B (A came AFTER and replaced B), A acquired B, ' +
  'A competed_with B (rivalry; pick the instigator as source or either if symmetric).'
const subtypeEnum = z.enum(['person', 'org', 'place', 'work'])
const subtypeHint =
  'For entity nodes, the kind: person, org (company/institution), place, or work (a creation/publication).'
const typeHint =
  'event = a point in time; entity = a person/org/place/work (set subtype); period = a span/era; ' +
  'concept = an idea/doctrine/principle (its start = when first articulated, end optional).'
const refHint =
  'Optional local alias for THIS node so a later add_edge in the same batch can reference it before it has a real id.'
const laneHint =
  'Swimlane this node belongs to (a short group name, e.g. a company/actor like "OpenAI"). ' +
  'Nodes sharing a lane render as one horizontal row, ordered left→right by date — ideal for comparing ' +
  'parallel tracks (rival companies, branches, factions). Omit for one-off nodes; reuse the EXACT same ' +
  'string for every node in a track.'
const locationHint =
  'Where this happened, as a plain display string ("Golgotha, Jerusalem", "Down House, Kent"). ' +
  'Shown in the node\'s detail panel — adds place texture; no geocoding.'
const latHint =
  'Latitude in decimal degrees (−90..90, negative = South). Plotted on the globe lens. ' +
  'Supply alongside `location` when you know where this happened; city-level precision is plenty. Pair with `lng`.'
const lngHint =
  'Longitude in decimal degrees (−180..180, negative = West). Pair with `lat` — supply both or neither.'
const geoScopeHint =
  'Explicit "cannot be pinned" marker — set INSTEAD of lat/lng when this node genuinely has no single place: ' +
  '"global" (happened everywhere — a worldwide era), "diffuse" (several real sites, no honest single anchor), ' +
  '"unknown" (the place is lost to history). Records the decision so coverage math and backfill prompts treat ' +
  'the node as resolved instead of still-missing. Never guess coordinates as a substitute — placeless is an ' +
  'answer, not a gap. Mutually exclusive with lat/lng (setting it clears any coordinates).'
const imageInput = z.object({
  url: z
    .string()
    .describe(
      'Public image URL you sourced — a real, web-accessible image (Wikimedia portrait, official logo, ' +
        'public-domain artwork). Synek stores the URL and renders it on the node; it does NOT generate images.',
    ),
  alt: z.string().optional().describe('Short caption / alt text — who or what the image shows.'),
  show: z.boolean().optional().describe('Display on the canvas card. Defaults to true.'),
  aspect: z
    .enum(['landscape', 'portrait'])
    .optional()
    .describe(
      'How to frame the image: "landscape" (horizontal, wider than tall) or "portrait" (vertical, taller than ' +
        'wide). Pick "portrait" for headshots/full-figure people and tall artworks; "landscape" for scenes, ' +
        'logos, and wide photos. Defaults to landscape.',
    ),
})
const imagesHint =
  'Images to show on this node — supply real, web-sourced image URLs you found (a Wikimedia portrait for a ' +
  'person, a logo for an org, public-domain art for an era/event). Gives the node a face instead of a bare box. ' +
  'Set each image\'s `aspect` to "portrait" for tall subjects (a standing figure, a headshot) or "landscape" for ' +
  'wide ones. On update_node, the array you pass REPLACES the node\'s images; omit to leave existing images untouched.'

type ImageInput = z.infer<typeof imageInput>
const normalizeImages = (imgs: ImageInput[]): NodeImage[] =>
  imgs.map((im) => ({
    url: im.url,
    ...(im.alt ? { alt: im.alt } : {}),
    show: im.show ?? true,
    ...(im.aspect ? { aspect: im.aspect } : {}),
  }))

// One edit in a batch. `ref` (on add_node/add_edge) lets a single batch create a
// node and then connect an edge to it — the alias resolves to the new id.
export const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    ref: z.string().optional().describe(refHint),
    type: z.enum(['event', 'entity', 'period', 'concept']).describe(typeHint),
    title: z.string(),
    summary: z.string().optional(),
    start: z.string().describe(dateHint),
    end: z.string().optional().describe('End for entity/period spans. Omit for events.'),
    precision: precisionEnum.optional(),
    citations: z.array(citation).optional(),
    subtype: subtypeEnum.optional().describe(subtypeHint),
    lane: z.string().optional().describe(laneHint),
    location: z.string().optional().describe(locationHint),
    lat: z.number().min(-90).max(90).optional().describe(latHint),
    lng: z.number().min(-180).max(180).optional().describe(lngHint),
    geoScope: z.enum(GEO_SCOPES).optional().describe(geoScopeHint),
    images: z.array(imageInput).optional().describe(imagesHint),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string().describe('Target node id (or a ref from earlier in this batch).'),
    type: z
      .enum(['event', 'entity', 'period', 'concept'])
      .optional()
      .describe('Reclassify the node (e.g. event → concept). Edges, citations, and images are kept.'),
    title: z.string().optional(),
    summary: z.string().optional(),
    start: z.string().optional().describe(dateHint),
    end: z.string().optional(),
    precision: precisionEnum.optional(),
    citations: z.array(citation).optional(),
    subtype: subtypeEnum.optional().describe(subtypeHint),
    lane: z.string().optional().describe(laneHint + ' Pass "" to clear the lane.'),
    location: z.string().optional().describe(locationHint + ' Pass "" to clear it.'),
    lat: z.number().min(-90).max(90).nullable().optional().describe(latHint + ' Pass null to clear coordinates.'),
    lng: z.number().min(-180).max(180).nullable().optional().describe(lngHint + ' Pass null to clear coordinates.'),
    geoScope: z.enum(GEO_SCOPES).nullable().optional().describe(geoScopeHint + ' Pass null to clear it.'),
    images: z.array(imageInput).optional().describe(imagesHint),
  }),
  z.object({
    op: z.literal('delete_node'),
    id: z.string().describe('Node id to delete (connected edges are removed too).'),
  }),
  z.object({
    op: z.literal('place_entity'),
    entityId: z
      .string()
      .describe('Place an EXISTING entity (from another timeline) onto this timeline as a new placement (ADR 0004).'),
    ref: z.string().optional().describe(refHint),
    lane: z.string().optional().describe(laneHint),
  }),
  z.object({
    op: z.literal('add_edge'),
    ref: z.string().optional().describe(refHint),
    sourceId: z.string().describe('Source node id (or a ref from this batch).'),
    targetId: z.string().describe('Target node id (or a ref from this batch).'),
    kind: kindEnum.describe(kindHint),
    label: z.string().optional(),
  }),
  z.object({
    op: z.literal('update_edge'),
    id: z.string(),
    kind: kindEnum.optional().describe(kindHint),
    label: z.string().optional(),
  }),
  z.object({
    op: z.literal('delete_edge'),
    id: z.string(),
  }),
])

export type Op = z.infer<typeof opSchema>
export type OpResult = { op: Op['op']; ref?: string } & ({ id: string } | { error: string })

// Apply a batch of ops to a PatchBuilder. Returns a per-op result list. Nothing
// touches the DB here — commitPatch (upstream) flushes the builder as one Patch.
export function applyOps(
  builder: PatchBuilder,
  ops: Op[],
  opts?: { ownerId?: string | null },
): { results: OpResult[] } {
  // ref alias -> real id, for nodes created earlier in this same batch.
  const refs = new Map<string, string>()
  const resolve = (id: string) => refs.get(id) ?? id
  const results: OpResult[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'add_node': {
        const start = parseDate(op.start)
        const end = op.end ? parseDate(op.end) : null
        const images = op.images?.length ? normalizeImages(op.images) : undefined
        const metadata: NodeMetadata | null =
          op.citations?.length ||
          op.subtype ||
          op.lane ||
          op.location ||
          op.lat != null ||
          op.lng != null ||
          op.geoScope ||
          images
            ? {
                ...(op.citations?.length ? { citations: op.citations } : {}),
                ...(op.subtype ? { subtype: op.subtype } : {}),
                ...(op.lane ? { lane: op.lane } : {}),
                ...(op.location ? { location: op.location } : {}),
                ...(op.lat != null ? { lat: op.lat } : {}),
                ...(op.lng != null ? { lng: op.lng } : {}),
                // Mutually exclusive with coordinates — coords win when one op
                // contradicts itself (coordinateWarnings flags it).
                ...(op.geoScope && op.lat == null && op.lng == null ? { geoScope: op.geoScope } : {}),
                ...(images ? { images } : {}),
              }
            : null
        const node = builder.addNode({
          type: op.type,
          title: op.title,
          summary: op.summary ?? null,
          startInstant: start.instant,
          endInstant: end?.instant ?? null,
          precision: (op.precision as Precision | undefined) ?? start.precision,
          metadata,
        })
        if (op.ref) refs.set(op.ref, node.id)
        results.push({ op: op.op, ref: op.ref, id: node.id })
        break
      }

      case 'update_node': {
        const id = resolve(op.id)
        const np: NodePatch = {}
        if (op.type) np.type = op.type
        if (op.title !== undefined) np.title = op.title
        if (op.summary !== undefined) np.summary = op.summary
        if (op.start) {
          const p = parseDate(op.start)
          np.startInstant = p.instant
          if (!op.precision) np.precision = p.precision
        }
        if (op.end) np.endInstant = parseDate(op.end).instant
        if (op.precision) np.precision = op.precision
        // Merge metadata so existing images/color/size aren't clobbered.
        if (
          op.citations ||
          op.subtype ||
          op.lane !== undefined ||
          op.location !== undefined ||
          op.lat !== undefined ||
          op.lng !== undefined ||
          op.geoScope !== undefined ||
          op.images
        ) {
          const prior = (builder.getNode(id)?.metadata ?? {}) as NodeMetadata
          const merged: NodeMetadata = {
            ...prior,
            ...(op.citations ? { citations: op.citations } : {}),
            ...(op.subtype ? { subtype: op.subtype } : {}),
          }
          // A supplied images array replaces the node's images; omitting leaves them as-is.
          if (op.images) merged.images = normalizeImages(op.images)
          // lane === "" clears the swimlane; any other string sets it.
          if (op.lane !== undefined) {
            if (op.lane === '') delete merged.lane
            else merged.lane = op.lane
          }
          // location === "" clears it; any other string sets it.
          if (op.location !== undefined) {
            if (op.location === '') delete merged.location
            else merged.location = op.location
          }
          // lat/lng === null clears the coordinate; a number sets it. They pair —
          // a lone coordinate is flagged by coordinateWarnings, not blocked here.
          // Setting a coordinate also clears geoScope: a pin and "cannot be
          // pinned" never coexist on a node.
          if (op.lat !== undefined) {
            if (op.lat === null) delete merged.lat
            else {
              merged.lat = op.lat
              delete merged.geoScope
            }
          }
          if (op.lng !== undefined) {
            if (op.lng === null) delete merged.lng
            else {
              merged.lng = op.lng
              delete merged.geoScope
            }
          }
          // geoScope === null clears it; a value sets it AND clears any pin.
          // When one op contradicts itself (coords + geoScope), coords win —
          // coordinateWarnings tells the client.
          if (op.geoScope !== undefined) {
            if (op.geoScope === null) delete merged.geoScope
            else if (op.lat == null && op.lng == null) {
              merged.geoScope = op.geoScope
              delete merged.lat
              delete merged.lng
            }
          }
          np.metadata = merged
        }
        // ADR 0004 R13: on an entity-backed node, CONTENT (title/summary/dates/
        // precision + content metadata) edits the shared entity (its own undo
        // stack, propagates to every placement); only `lane` (per-placement) stays
        // a graph patch. A bare legacy node (no entityId) keeps today's behavior.
        const cur = builder.getNode(id)
        if (cur?.entityId) {
          const entityPatch: EntityContentPatch = {}
          if (np.type !== undefined) entityPatch.type = np.type
          if (np.title !== undefined) entityPatch.title = np.title
          if (np.summary !== undefined) entityPatch.summary = np.summary
          if (np.startInstant !== undefined) entityPatch.startInstant = np.startInstant
          if (np.endInstant !== undefined) entityPatch.endInstant = np.endInstant
          if (np.precision !== undefined) entityPatch.precision = np.precision
          if (np.metadata != null) {
            const contentMeta: NodeMetadata = { ...np.metadata }
            delete contentMeta.lane
            entityPatch.metadata = contentMeta
          }
          if (Object.keys(entityPatch).length > 0) {
            commitEntityPatch(cur.entityId, entityPatch, `Edit: ${op.title ?? cur.title}`)
          }
          // lane → the placement (graph patch). np.metadata is always set when
          // op.lane is present (the metadata block triggers on it).
          if (op.lane !== undefined && np.metadata != null) {
            const laneMeta: NodeMetadata = {}
            if (np.metadata.lane) laneMeta.lane = np.metadata.lane
            builder.updateNode(id, { metadata: laneMeta })
          }
          results.push({ op: op.op, id })
        } else {
          results.push(builder.updateNode(id, np) ? { op: op.op, id } : { op: op.op, error: `node ${id} not found` })
        }
        break
      }

      case 'delete_node': {
        const id = resolve(op.id)
        results.push(builder.deleteNode(id) ? { op: op.op, id } : { op: op.op, error: `node ${id} not found` })
        break
      }

      case 'place_entity': {
        // Place an EXISTING owned entity as a new placement on this timeline.
        const entity = db.select().from(entities).where(eq(entities.id, op.entityId)).get()
        if (!entity || (opts?.ownerId != null && entity.ownerId !== opts.ownerId)) {
          results.push({ op: op.op, ref: op.ref, error: `entity ${op.entityId} not found` })
          break
        }
        const node = builder.placeEntity(entity, { lane: op.lane })
        if (op.ref) refs.set(op.ref, node.id)
        results.push({ op: op.op, ref: op.ref, id: node.id })
        break
      }

      case 'add_edge': {
        const r = builder.addEdge({
          sourceId: resolve(op.sourceId),
          targetId: resolve(op.targetId),
          kind: op.kind,
          label: op.label,
        })
        if ('error' in r) {
          results.push({ op: op.op, ref: op.ref, error: r.error })
        } else {
          if (op.ref) refs.set(op.ref, r.id)
          results.push({ op: op.op, ref: op.ref, id: r.id })
        }
        break
      }

      case 'update_edge': {
        const ep: EdgePatch = {}
        if (op.kind) ep.kind = op.kind
        if (op.label !== undefined) ep.label = op.label
        results.push(
          builder.updateEdge(op.id, ep) ? { op: op.op, id: op.id } : { op: op.op, error: `edge ${op.id} not found` },
        )
        break
      }

      case 'delete_edge': {
        results.push(
          builder.deleteEdge(op.id) ? { op: op.op, id: op.id } : { op: op.op, error: `edge ${op.id} not found` },
        )
        break
      }
    }
  }

  return { results }
}
