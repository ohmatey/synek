import type { PatchBuilder } from './patches'
import type { NodeMetadata } from './schema'
import type { NodeImage } from '~/lib/domain/types'
import { IMAGE_MODEL_SLUG } from '~/lib/ai/provider'
import { buildImagePrompt, generateImageData } from '~/lib/ai/image'
import { ensureImageTemplate, computeCacheKey, findCachedImageUrl, recordImageGeneration } from './images'

// Generate a period-authentic illustration for a node and attach it to the
// node's metadata.images via the PatchBuilder — so it commits as ONE atomic,
// undoable Patch with the turn/action. Shared by the chat `generate_image`
// tool and the panel's direct "Illustrate" server action (one code path).
// Cache-by-hash: an identical brief for the same node reuses the prior image
// (no model call). Nothing hits the DB here except the provenance row — the
// graph mutation is buffered on the builder and committed by the caller.
export async function illustrateOnBuilder(
  builder: PatchBuilder,
  nodeId: string,
  brief: string,
  alt?: string,
): Promise<{ ok: true; cached: boolean; image: NodeImage } | { ok: false; error: string }> {
  const node = builder.getNode(nodeId)
  if (!node) return { ok: false, error: `node ${nodeId} not found` }

  const template = ensureImageTemplate()
  const promptInputs = { model: IMAGE_MODEL_SLUG, nodeId, prompt: brief }
  const cacheKey = computeCacheKey(template.id, promptInputs)

  let dataUrl = findCachedImageUrl(cacheKey)
  const cached = dataUrl !== null
  if (!dataUrl) {
    const gen = await generateImageData(buildImagePrompt(node, brief))
    dataUrl = gen.dataUrl
    recordImageGeneration({
      nodeId,
      template,
      cacheKey,
      promptInputs,
      dataUrl,
      modelSlug: gen.modelSlug,
      latencyMs: gen.latencyMs,
    })
  }

  // Merge into metadata.images so citations/color/size/subtype are preserved;
  // the inverse op records the prior metadata, so ⌘Z removes the image.
  const prior = (node.metadata ?? {}) as NodeMetadata
  const image: NodeImage = { url: dataUrl, alt: alt ?? node.title, show: true }
  builder.updateNode(nodeId, { metadata: { ...prior, images: [...(prior.images ?? []), image] } })
  return { ok: true, cached, image }
}
