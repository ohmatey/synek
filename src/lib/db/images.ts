import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { generations, promptTemplates, type PromptTemplateRow } from './schema'
import { computeCacheKey } from './stories'
import { IMAGE_TEMPLATE_NAME, IMAGE_TEMPLATE_BODY, IMAGE_STYLE } from '~/lib/ai/image'

export { computeCacheKey }

// Find-or-create the image prompt template (keeps the generations FK honest).
export function ensureImageTemplate(): PromptTemplateRow {
  const existing = db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.name, IMAGE_TEMPLATE_NAME), eq(promptTemplates.active, true)))
    .get()
  if (existing) return existing
  return db
    .insert(promptTemplates)
    .values({
      name: IMAGE_TEMPLATE_NAME,
      version: 1,
      purpose: 'image',
      body: IMAGE_TEMPLATE_BODY,
      systemPrompt: IMAGE_STYLE,
      active: true,
    })
    .returning()
    .get()
}

// Cache: the generated data-URL is stored on the generations row's outputJson,
// keyed by cacheKey. A hit returns the prior image with no model call.
export function findCachedImageUrl(cacheKey: string): string | null {
  const row = db
    .select({ output: generations.outputJson })
    .from(generations)
    .where(and(eq(generations.cacheKey, cacheKey), eq(generations.targetKind, 'image')))
    .orderBy(desc(generations.createdAt))
    .get()
  const url = row?.output?.dataUrl
  return typeof url === 'string' ? url : null
}

export type RecordImageInput = {
  nodeId: string
  template: PromptTemplateRow
  cacheKey: string
  promptInputs: Record<string, unknown>
  dataUrl: string
  modelSlug: string
  latencyMs: number
}

// Provenance row for one generated image (separate from the graph Patch).
export function recordImageGeneration(input: RecordImageInput): void {
  db.insert(generations)
    .values({
      targetKind: 'image',
      targetId: input.nodeId,
      cacheKey: input.cacheKey,
      model: input.modelSlug,
      promptTemplateId: input.template.id,
      promptInputsJson: input.promptInputs,
      outputJson: { dataUrl: input.dataUrl },
      latencyMs: input.latencyMs,
    })
    .run()
}
