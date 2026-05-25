import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { db } from './index'
import {
  nodes,
  edges,
  stories,
  storySegments,
  generations,
  promptTemplates,
  type NodeRow,
  type StoryRow,
  type PromptTemplateRow,
} from './schema'
import type { StoryDTO, StorySegmentDTO } from '~/lib/domain/types'
import { STORY_TEMPLATE_NAME, STORY_SYSTEM, STORY_TEMPLATE_BODY, type StoryObject } from '~/lib/ai/generate'

// --- moment context (moment + edge-linked neighbors) ----------------------

export function loadMomentContext(momentId: string): { moment: NodeRow; neighbors: NodeRow[] } | null {
  const moment = db.select().from(nodes).where(eq(nodes.id, momentId)).get()
  if (!moment) return null
  const connected = db
    .select()
    .from(edges)
    .where(or(eq(edges.sourceId, momentId), eq(edges.targetId, momentId)))
    .all()
  const ids = [...new Set(connected.flatMap((e) => [e.sourceId, e.targetId]).filter((id) => id !== momentId))]
  const neighbors = ids.length ? db.select().from(nodes).where(inArray(nodes.id, ids)).all() : []
  return { moment, neighbors }
}

// --- prompt template (find-or-create; keeps the provenance FK honest) -----

export function ensureStoryTemplate(): PromptTemplateRow {
  const existing = db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.name, STORY_TEMPLATE_NAME), eq(promptTemplates.active, true)))
    .get()
  if (existing) return existing
  return db
    .insert(promptTemplates)
    .values({
      name: STORY_TEMPLATE_NAME,
      version: 1,
      purpose: 'story',
      body: STORY_TEMPLATE_BODY,
      systemPrompt: STORY_SYSTEM,
      active: true,
    })
    .returning()
    .get()
}

// --- cache key (stable hash of template + resolved inputs) -----------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function computeCacheKey(templateId: string, promptInputs: Record<string, unknown>): string {
  return createHash('sha256').update(`${templateId}:${stableStringify(promptInputs)}`).digest('hex')
}

// --- assembly to DTO ------------------------------------------------------

function loadSegments(storyId: string): StorySegmentDTO[] {
  return db
    .select()
    .from(storySegments)
    .where(eq(storySegments.storyId, storyId))
    .orderBy(asc(storySegments.sequence))
    .all()
    .map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      bodyText: s.bodyText,
      settingNote: s.settingNote ?? null,
      relatedNodeIds: s.relatedNodeIds ?? [],
    }))
}

function toStoryDTO(s: StoryRow): StoryDTO {
  return {
    id: s.id,
    momentId: s.momentId,
    title: s.title,
    hook: s.hook ?? null,
    povType: s.povType,
    depthTier: s.depthTier,
    estimatedMinutes: s.estimatedMinutes ?? null,
    status: s.status,
    segments: loadSegments(s.id),
  }
}

export function getStoryById(storyId: string): StoryDTO | null {
  const s = db.select().from(stories).where(eq(stories.id, storyId)).get()
  return s ? toStoryDTO(s) : null
}

export function getLiveStoriesForMoment(momentId: string): StoryDTO[] {
  return db
    .select()
    .from(stories)
    .where(and(eq(stories.momentId, momentId), ne(stories.status, 'archived')))
    .orderBy(desc(stories.createdAt))
    .all()
    .map(toStoryDTO)
}

// A cache hit must be a LIVE story (archived ones — superseded by a regenerate —
// don't count). Newest generation with this key wins.
export function findLiveStoryByCacheKey(cacheKey: string): StoryDTO | null {
  const row = db
    .select({ s: stories })
    .from(generations)
    .innerJoin(stories, eq(generations.targetId, stories.id))
    .where(
      and(eq(generations.cacheKey, cacheKey), eq(generations.targetKind, 'story'), ne(stories.status, 'archived')),
    )
    .orderBy(desc(generations.createdAt))
    .get()
  return row ? toStoryDTO(row.s) : null
}

// --- commit (one transaction: story + generation + segments) --------------

function slugify(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'story'
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export type CommitStoryInput = {
  momentId: string
  template: PromptTemplateRow
  modelSlug: string
  cacheKey: string
  promptInputs: Record<string, unknown>
  object: StoryObject
  neighborIds: string[]
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
  archivePriorId?: string | null
}

export function commitStory(input: CommitStoryInput): StoryDTO {
  const neighborSet = new Set(input.neighborIds)
  let storyId = ''
  db.transaction((tx) => {
    if (input.archivePriorId) {
      tx.update(stories)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(stories.id, input.archivePriorId))
        .run()
    }
    const story = tx
      .insert(stories)
      .values({
        momentId: input.momentId,
        slug: slugify(input.object.title),
        title: input.object.title,
        hook: input.object.hook,
        povType: 'omniscient', // S1: always omniscient
        depthTier: 'light', // S1: generated
        estimatedMinutes: input.object.estimatedMinutes,
        status: 'draft',
      })
      .returning()
      .get()
    storyId = story.id
    const gen = tx
      .insert(generations)
      .values({
        targetKind: 'story',
        targetId: story.id,
        cacheKey: input.cacheKey,
        model: input.modelSlug,
        promptTemplateId: input.template.id,
        promptInputsJson: input.promptInputs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
      })
      .returning()
      .get()
    // Sequence is assigned by array order — more reliable than trusting the model.
    input.object.segments.forEach((seg, i) => {
      const related = (seg.relatedNodeIds ?? []).filter((id) => neighborSet.has(id))
      tx.insert(storySegments)
        .values({
          storyId: story.id,
          sequence: i,
          kind: seg.kind,
          bodyText: seg.bodyText,
          settingNote: seg.settingNote ?? null,
          relatedNodeIds: related,
          generationId: gen.id,
        })
        .run()
    })
  })
  const dto = getStoryById(storyId)
  if (!dto) throw new Error('story commit failed')
  return dto
}
