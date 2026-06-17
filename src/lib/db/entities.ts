import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { entities, nodes, timelines, type NodeMetadata } from './schema'
import type { HomeEntityCard } from '~/lib/domain/types'

// First displayable image on an entity → the card thumbnail. Prefers an image
// flagged for display (`show !== false`), else the first attached image; null when
// the entity carries none (the card then renders a type-icon wash, like StoryCard).
function pickThumbnail(meta: NodeMetadata | null): { url: string; alt: string | null } | null {
  const imgs = meta?.images
  if (!imgs || imgs.length === 0) return null
  const shown = imgs.find((i) => i.show !== false) ?? imgs[0]
  return { url: shown.url, alt: shown.alt ?? null }
}

// Every canonical entity (ADR 0004) the OWNER has, surfaced for the cinematic home's
// "Entities" browse row — optionally narrowed to one project. An entity is shared:
// it can be placed on many timelines across projects, so we group its placements and
// report `timelineCount` (its reach) plus the first-placed node as the "Open" target.
//
// Owner-scope is the security boundary (joined through each placement's timeline
// ownerId — the same pattern as listStoriesForHome); `projectId` is an organizational
// filter WITHIN the owner (D10), so a foreign/unowned project simply matches nothing
// and degrades to empty. Legacy bare nodes (entityId null) aren't entities and don't
// appear. One query + an in-memory group keeps it free of N+1s.
export function listEntitiesForHome(ownerId: string, projectId?: string): HomeEntityCard[] {
  const rows = db
    .select({
      entityId: entities.id,
      title: entities.title,
      type: entities.type,
      summary: entities.summary,
      metadata: entities.metadata,
      updatedAt: entities.updatedAt,
      nodeId: nodes.id,
      timelineId: nodes.timelineId,
      placedAt: nodes.createdAt,
    })
    .from(nodes)
    .innerJoin(entities, eq(nodes.entityId, entities.id))
    .innerJoin(timelines, eq(nodes.timelineId, timelines.id))
    .where(
      projectId
        ? and(eq(timelines.ownerId, ownerId), eq(timelines.projectId, projectId))
        : eq(timelines.ownerId, ownerId),
    )
    // Newest-edited content first. Rows for one entity are interleaved, but the Map
    // below preserves first-seen insertion order, which is this sort.
    .orderBy(desc(entities.updatedAt))
    .all()

  type Agg = {
    card: Omit<HomeEntityCard, 'timelineCount'>
    timelineIds: Set<string>
    primaryPlacedAt: number
  }
  const byEntity = new Map<string, Agg>()
  for (const r of rows) {
    const placedAt = r.placedAt.getTime()
    let agg = byEntity.get(r.entityId)
    if (!agg) {
      agg = {
        card: {
          entityId: r.entityId,
          title: r.title,
          type: r.type,
          summary: r.summary,
          thumbnail: pickThumbnail(r.metadata),
          primaryTimelineId: r.timelineId,
          primaryNodeId: r.nodeId,
          updatedAt: r.updatedAt.getTime(),
        },
        timelineIds: new Set([r.timelineId]),
        primaryPlacedAt: placedAt,
      }
      byEntity.set(r.entityId, agg)
    } else {
      agg.timelineIds.add(r.timelineId)
      // The earliest placement is the canonical home — the "Open" target.
      if (placedAt < agg.primaryPlacedAt) {
        agg.primaryPlacedAt = placedAt
        agg.card.primaryTimelineId = r.timelineId
        agg.card.primaryNodeId = r.nodeId
      }
    }
  }

  return [...byEntity.values()].map((a) => ({ ...a.card, timelineCount: a.timelineIds.size }))
}
