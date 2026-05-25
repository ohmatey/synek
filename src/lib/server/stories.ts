import { createServerFn } from '@tanstack/react-start'
import {
  loadMomentContext,
  ensureStoryTemplate,
  computeCacheKey,
  findLiveStoryByCacheKey,
  commitStory,
  getStoryById,
  getLiveStoriesForMoment,
} from '~/lib/db/stories'
import { generateStoryObject } from '~/lib/ai/generate'
import { STORY_MODEL_SLUG } from '~/lib/ai/provider'
import type { NodeRow } from '~/lib/db/schema'
import type { StoryDTO } from '~/lib/domain/types'

// Deterministic inputs that fully determine the output — the cache-key source.
// Anything that would change the story must appear here (model, moment, neighbors).
function buildPromptInputs(moment: NodeRow, neighbors: NodeRow[], modelSlug: string): Record<string, unknown> {
  return {
    model: modelSlug,
    moment: {
      id: moment.id,
      type: moment.type,
      title: moment.title,
      summary: moment.summary,
      startInstant: moment.startInstant,
      precision: moment.precision,
    },
    neighbors: neighbors
      .map((n) => ({ id: n.id, title: n.title, startInstant: n.startInstant }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  }
}

// Tap a moment → its story. Cache hit returns instantly (no model call); else
// generate, then commit story + segments + generation in one transaction.
export const generateStory = createServerFn({ method: 'POST' })
  .inputValidator((momentId: string) => momentId)
  .handler(async ({ data: momentId }): Promise<StoryDTO> => {
    const ctx = loadMomentContext(momentId)
    if (!ctx) throw new Error(`moment ${momentId} not found`)
    const template = ensureStoryTemplate()
    const promptInputs = buildPromptInputs(ctx.moment, ctx.neighbors, STORY_MODEL_SLUG)
    const cacheKey = computeCacheKey(template.id, promptInputs)

    const cached = findLiveStoryByCacheKey(cacheKey)
    if (cached) return cached

    const gen = await generateStoryObject(ctx.moment, ctx.neighbors)
    return commitStory({
      momentId,
      template,
      modelSlug: gen.modelSlug,
      cacheKey,
      promptInputs,
      object: gen.object,
      neighborIds: ctx.neighbors.map((n) => n.id),
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      latencyMs: gen.latencyMs,
    })
  })

// Live (non-archived) stories for a moment, newest first.
export const getStories = createServerFn({ method: 'GET' })
  .inputValidator((momentId: string) => momentId)
  .handler(({ data: momentId }): StoryDTO[] => getLiveStoriesForMoment(momentId))

export const getStory = createServerFn({ method: 'GET' })
  .inputValidator((storyId: string) => storyId)
  .handler(({ data: storyId }): StoryDTO | null => getStoryById(storyId))

// Force a fresh telling: skip the cache, archive the prior story.
export const regenerateStory = createServerFn({ method: 'POST' })
  .inputValidator((storyId: string) => storyId)
  .handler(async ({ data: storyId }): Promise<StoryDTO> => {
    const prior = getStoryById(storyId)
    if (!prior) throw new Error(`story ${storyId} not found`)
    const ctx = loadMomentContext(prior.momentId)
    if (!ctx) throw new Error(`moment ${prior.momentId} not found`)
    const template = ensureStoryTemplate()
    const promptInputs = buildPromptInputs(ctx.moment, ctx.neighbors, STORY_MODEL_SLUG)
    const cacheKey = computeCacheKey(template.id, promptInputs)

    const gen = await generateStoryObject(ctx.moment, ctx.neighbors) // no cache check — always fresh
    return commitStory({
      momentId: prior.momentId,
      template,
      modelSlug: gen.modelSlug,
      cacheKey,
      promptInputs,
      object: gen.object,
      neighborIds: ctx.neighbors.map((n) => n.id),
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      latencyMs: gen.latencyMs,
      archivePriorId: storyId,
    })
  })
