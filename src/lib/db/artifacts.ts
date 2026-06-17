import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db, sqlite } from './index'
import { artifacts, sources, momentArtifacts, storyArtifacts, stories, nodes, entities } from './schema'
import type { ArtifactRow, SourceRow } from './schema'
import type { ArtifactType, CitationSourceType, Precision, Reliability, SourceType } from '~/lib/domain/types'

// Sources + artifacts are reusable REFERENCE DATA (ADR 0001) — direct CRUD, NOT
// graph Patches, so everything here uses its own transaction and never touches
// `patches`. The FK joins (story_artifacts / segment_citations) are written by the
// write_story transaction (see stories.ts); moment_artifacts is written here.

export type NewSource = {
  ownerId?: string | null
  title: string
  author?: string | null
  year?: number | null
  citation?: string | null
  url?: string | null
  sourceType?: SourceType | null
}

export type NewArtifact = {
  ownerId?: string | null
  title: string
  artifactType: ArtifactType
  dateInstant?: number | null
  datePrecision?: Precision
  transcript?: string | null
  translation?: string | null
  imageUrl?: string | null
  reliability?: Reliability | null
  reliabilityNote?: string | null
  sourceType?: CitationSourceType | null // genre, orthogonal to reliability
  sourceId?: string | null
  attributedPersonId?: string | null
}

export function createSource(input: NewSource): SourceRow {
  return db
    .insert(sources)
    .values({
      ownerId: input.ownerId ?? null,
      title: input.title,
      author: input.author ?? null,
      year: input.year ?? null,
      citation: input.citation ?? null,
      url: input.url ?? null,
      sourceType: input.sourceType ?? null,
    })
    .returning()
    .get()
}

export function createArtifact(input: NewArtifact): ArtifactRow {
  return db
    .insert(artifacts)
    .values({
      ownerId: input.ownerId ?? null,
      title: input.title,
      artifactType: input.artifactType,
      dateInstant: input.dateInstant ?? null,
      datePrecision: input.datePrecision ?? 'year',
      transcript: input.transcript ?? null,
      translation: input.translation ?? null,
      imageUrl: input.imageUrl ?? null,
      reliability: input.reliability ?? null,
      reliabilityNote: input.reliabilityNote ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      attributedPersonId: input.attributedPersonId ?? null,
    })
    .returning()
    .get()
}

// Curation edit, owner-scoped. Returns the updated row (the FTS5 AFTER UPDATE
// trigger keeps the index in lockstep). Partial — only the provided fields change;
// `ownerId` is never reassigned via patch.
export function updateArtifact(id: string, patch: Partial<NewArtifact>, ownerId: string): ArtifactRow | null {
  const { ownerId: _ignore, ...fields } = patch
  const row = db
    .update(artifacts)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(artifacts.id, id), eq(artifacts.ownerId, ownerId)))
    .returning()
    .get()
  return row ?? null
}

export function deleteArtifact(id: string, ownerId: string): boolean {
  return db.delete(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.ownerId, ownerId))).run().changes > 0
}

export function getArtifactById(id: string, ownerId: string): ArtifactRow | null {
  return db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.ownerId, ownerId))).get() ?? null
}

// Which of the given artifact ids exist AND belong to this owner — lets write_story
// drop unknown / cross-tenant `artifactId` refs to a warning instead of throwing an
// FK error or citing another user's artifact.
export function existingArtifactIds(ids: string[], ownerId: string): Set<string> {
  if (!ids.length) return new Set()
  const rows = db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(inArray(artifacts.id, ids), eq(artifacts.ownerId, ownerId)))
    .all()
  return new Set(rows.map((r) => r.id))
}

// Link an artifact to a moment (node). Idempotent on the composite PK so a re-link
// is a no-op rather than a constraint error.
export function linkMomentArtifact(momentId: string, artifactId: string, note?: string | null): void {
  db.insert(momentArtifacts)
    .values({ momentId, artifactId, note: note ?? null })
    .onConflictDoNothing()
    .run()
}

export function unlinkMomentArtifact(momentId: string, artifactId: string): void {
  db.delete(momentArtifacts)
    .where(and(eq(momentArtifacts.momentId, momentId), eq(momentArtifacts.artifactId, artifactId)))
    .run()
}

// Artifact-first browse: every artifact that belongs to a timeline — linked to one
// of its moments (moment_artifacts) and/or anchoring one of its stories
// (story_artifacts) — with the moments it sits on and the stories it anchors.
// Ordered by dateInstant then title so it's also the canvas-lens feed (S2.4).
export type ArtifactBrowseRow = {
  artifact: ArtifactRow
  moments: { id: string; title: string }[]
  stories: { id: string; title: string; momentId: string }[]
}

export function listArtifactsForTimeline(timelineId: string): ArtifactBrowseRow[] {
  // Artifacts reachable from this timeline via either link, then hydrate each.
  const viaMoment = db
    .select({
      artifactId: momentArtifacts.artifactId,
      momentId: nodes.id,
      // R8 (ADR 0004): the moment title is canonical on its entity.
      momentTitle: sql<string>`coalesce(${entities.title}, ${nodes.title})`,
    })
    .from(momentArtifacts)
    .innerJoin(nodes, eq(momentArtifacts.momentId, nodes.id))
    .leftJoin(entities, eq(nodes.entityId, entities.id))
    .where(eq(nodes.timelineId, timelineId))
    .all()
  const viaStory = db
    .select({ artifactId: storyArtifacts.artifactId, storyId: stories.id, storyTitle: stories.title, momentId: stories.momentId })
    .from(storyArtifacts)
    .innerJoin(stories, eq(storyArtifacts.storyId, stories.id))
    .innerJoin(nodes, eq(stories.momentId, nodes.id))
    .where(eq(nodes.timelineId, timelineId))
    .all()

  const ids = [...new Set([...viaMoment.map((r) => r.artifactId), ...viaStory.map((r) => r.artifactId)])]
  if (!ids.length) return []
  const rows = db.select().from(artifacts).where(inArray(artifacts.id, ids)).all()
  rows.sort((a, b) => (a.dateInstant ?? 0) - (b.dateInstant ?? 0) || a.title.localeCompare(b.title))

  return rows.map((artifact) => ({
    artifact,
    moments: viaMoment.filter((m) => m.artifactId === artifact.id).map((m) => ({ id: m.momentId, title: m.momentTitle })),
    stories: viaStory
      .filter((s) => s.artifactId === artifact.id)
      .map((s) => ({ id: s.storyId, title: s.storyTitle, momentId: s.momentId })),
  }))
}

// Every artifact linked to a moment, oldest first.
export function listArtifactsForMoment(momentId: string): ArtifactRow[] {
  return db
    .select({ a: artifacts })
    .from(momentArtifacts)
    .innerJoin(artifacts, eq(momentArtifacts.artifactId, artifacts.id))
    .where(eq(momentArtifacts.momentId, momentId))
    .orderBy(asc(artifacts.createdAt))
    .all()
    .map((r) => r.a)
}

// Register a reusable artifact in one transaction: an optional source, the
// artifact, and an optional link to a moment. The MCP `register_artifact` tool is
// a thin wrapper over this.
export function registerArtifact(input: {
  ownerId: string
  artifact: NewArtifact
  source?: NewSource
  momentId?: string | null
  momentNote?: string | null
}): { artifactId: string; sourceId: string | null } {
  let artifactId = ''
  let sourceId: string | null = input.artifact.sourceId ?? null
  db.transaction((tx) => {
    if (input.source) {
      sourceId = tx
        .insert(sources)
        .values({
          ownerId: input.ownerId,
          title: input.source.title,
          author: input.source.author ?? null,
          year: input.source.year ?? null,
          citation: input.source.citation ?? null,
          url: input.source.url ?? null,
          sourceType: input.source.sourceType ?? null,
        })
        .returning({ id: sources.id })
        .get()!.id
    }
    artifactId = tx
      .insert(artifacts)
      .values({
        ownerId: input.ownerId,
        title: input.artifact.title,
        artifactType: input.artifact.artifactType,
        dateInstant: input.artifact.dateInstant ?? null,
        datePrecision: input.artifact.datePrecision ?? 'year',
        transcript: input.artifact.transcript ?? null,
        translation: input.artifact.translation ?? null,
        imageUrl: input.artifact.imageUrl ?? null,
        reliability: input.artifact.reliability ?? null,
        reliabilityNote: input.artifact.reliabilityNote ?? null,
        sourceType: input.artifact.sourceType ?? null,
        sourceId,
        attributedPersonId: input.artifact.attributedPersonId ?? null,
      })
      .returning({ id: artifacts.id })
      .get()!.id
    if (input.momentId) {
      tx.insert(momentArtifacts)
        .values({ momentId: input.momentId, artifactId, note: input.momentNote ?? null })
        .onConflictDoNothing()
        .run()
    }
  })
  return { artifactId, sourceId }
}

// --- search (S2.5, FTS5) --------------------------------------------------

export type ArtifactSearchRow = {
  id: string
  title: string
  artifactType: string
  snippet: string
  reliability: string | null
  sourceType: string | null
  sourceTitle: string | null
  dateInstant: number | null
  datePrecision: string | null
  imageUrl: string | null
  // Opaque "higher is better" — BM25 today, cosine distance later. The client
  // must NOT interpret it; no backend name (bm25/rank/distance) leaks.
  score: number
}

export type SearchArtifactsParams = {
  query: string
  // Owner scope — ALWAYS applied (multi-tenant: a search never crosses tenants,
  // even when no timelineId narrows it). Standalone (unlinked) artifacts are still
  // findable, but only by their owner.
  ownerId: string
  timelineId?: string
  types?: ArtifactType[]
  reliability?: Reliability[]
  limit?: number
}

// Turn arbitrary user text into a safe FTS5 MATCH expression. Strip everything
// that isn't a letter or number to whitespace — so FTS5 operators/punctuation
// (-, *, :, (, ", NEAR, etc.) drop out instead of throwing `fts5: syntax error`
// — then wrap each surviving token in double-quotes (a literal term, never an
// operator). Implicit AND across tokens. All-punctuation input → empty.
function toMatchExpr(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' ')
}

// Lexical recall over the artifact corpus (ADR 0001, Decision 6). Backend-agnostic
// contract: query in → ranked compact rows out. Raw SQL via the better-sqlite3
// handle — drizzle has no FTS5 MATCH/bm25/snippet support.
export function searchArtifacts(params: SearchArtifactsParams): ArtifactSearchRow[] {
  const match = toMatchExpr(params.query)
  if (!match) return []
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50)

  const where: string[] = ['artifacts_fts MATCH ?', 'a.owner_id = ?']
  const args: unknown[] = [match, params.ownerId]

  if (params.types?.length) {
    where.push(`a.artifact_type IN (${params.types.map(() => '?').join(', ')})`)
    args.push(...params.types)
  }
  if (params.reliability?.length) {
    where.push(`a.reliability IN (${params.reliability.map(() => '?').join(', ')})`)
    args.push(...params.reliability)
  }
  // Scope to a timeline via the moment links (artifacts have no timelineId — they
  // are a cross-timeline corpus). An artifact appears once regardless of how many
  // of the timeline's moments it sits on (IN-subquery, not a join → no dupes).
  if (params.timelineId) {
    where.push(
      `a.id IN (SELECT ma.artifact_id FROM moment_artifacts ma JOIN nodes n ON n.id = ma.moment_id WHERE n.timeline_id = ?)`,
    )
    args.push(params.timelineId)
  }

  const sql = `
    SELECT a.id AS id, a.title AS title, a.artifact_type AS artifactType,
           snippet(artifacts_fts, -1, '[', ']', '…', 12) AS snippet,
           a.reliability AS reliability, a.artifact_source_type AS sourceType,
           s.title AS sourceTitle,
           a.date_instant AS dateInstant, a.date_precision AS datePrecision,
           a.image_url AS imageUrl,
           bm25(artifacts_fts) AS rank
    FROM artifacts_fts
    JOIN artifacts a ON a.rowid = artifacts_fts.rowid
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE ${where.join(' AND ')}
    ORDER BY rank
    LIMIT ?`
  args.push(limit)

  const rows = sqlite.prepare(sql).all(...args) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    artifactType: r.artifactType as string,
    snippet: (r.snippet as string) ?? '',
    reliability: (r.reliability as string) ?? null,
    sourceType: (r.sourceType as string) ?? null,
    sourceTitle: (r.sourceTitle as string) ?? null,
    dateInstant: (r.dateInstant as number) ?? null,
    datePrecision: (r.datePrecision as string) ?? null,
    imageUrl: (r.imageUrl as string) ?? null,
    // bm25 is "more negative = better"; flip to "higher is better", drop the name.
    score: -(r.rank as number),
  }))
}
