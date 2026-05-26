import { experimental_generateImage as generateImage } from 'ai'
import { imageModel, IMAGE_MODEL_SLUG } from './provider'
import { formatInstant } from '~/lib/domain/dates'
import type { NodeRow } from '~/lib/db/schema'

// Image generation is a separate, provenance-tracked flow — NOT a graph Patch.
// The tool that calls this buffers the resulting data-URL onto the node via the
// PatchBuilder, so it commits as one atomic, undoable Patch with the turn.

export const IMAGE_TEMPLATE_NAME = 'generate_node_image_v1'

// Period-authentic house style. We label outputs as illustrations because they
// are fabricated likenesses — honest with the product's source-grounded ethos.
export const IMAGE_STYLE = `Period-authentic illustration: render in the visual style of the subject's own era (e.g. a Renaissance figure as a Renaissance painting, a 1960s scene as a period photograph). A single, clear, well-composed subject. This is an interpretive illustration, not a real photograph of a real person.`

export const IMAGE_TEMPLATE_BODY = `Illustrate {{node}} in a period-authentic style. Visual focus: {{prompt}}.`

// Build the final image prompt from the node's facts + the model's visual brief.
export function buildImagePrompt(node: NodeRow, visualBrief: string): string {
  const date = formatInstant(node.startInstant, node.precision)
  return `${IMAGE_STYLE}

Subject: "${node.title}" (${node.type}, ${date}).${node.summary ? ` Context: ${node.summary}` : ''}
What to depict: ${visualBrief}`
}

export type ImageGenResult = {
  dataUrl: string
  modelSlug: string
  latencyMs: number
}

// Calls the image model. The caller handles cache + persistence/provenance.
export async function generateImageData(prompt: string): Promise<ImageGenResult> {
  const started = Date.now()
  const { image } = await generateImage({
    model: imageModel(),
    prompt,
    size: '1024x1024', // gpt-image-1's smallest square — keeps the data-URL modest
  })
  return {
    dataUrl: `data:${image.mediaType};base64,${image.base64}`,
    modelSlug: IMAGE_MODEL_SLUG,
    latencyMs: Date.now() - started,
  }
}
