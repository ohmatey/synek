import { generateObject } from 'ai'
import { z } from 'zod'
import { storyModel, STORY_MODEL_SLUG } from './provider'
import { formatInstant } from '~/lib/domain/dates'
import { SEGMENT_KINDS } from '~/lib/domain/types'
import type { NodeRow } from '~/lib/db/schema'

// Story generation is a separate, provenance-tracked flow — NOT a graph Patch.
// It emits a structured object (generateObject) rather than calling graph tools.

export const STORY_TEMPLATE_NAME = 'generate_story_v1'

export const STORY_SYSTEM = `You are the storyteller inside Strata, a tool for reading history as short, grounded micro-stories anchored to moments on a timeline.

Tell the story of one moment as an OMNISCIENT narrator — a calm, vivid voice that can see the whole scene. Not a textbook entry; a told story.

Rules:
- 3–8 ordered beats. Each beat is one of: narration (prose that moves the story), dialogue (something said, in plain quotes), sensory (set-dressing: light, sound, smell, weather), interior (a felt thought, kept general — no named person's private mind yet).
- Ground every claim in what the moment and its related moments actually say. Do NOT invent dates, names, numbers, or quotes. If you don't know, stay general and atmospheric rather than fabricating specifics.
- Keep it tight and readable — a 1–3 minute read. Concrete over abstract.
- A beat may reference a RELATED moment when the story genuinely touches it: put that moment's id in the beat's relatedNodeIds (only ids from the provided list). Don't force connections.
- Write a short, evocative title and a one-sentence hook that makes someone want to read.`

// Stored in prompt_templates.body for provenance (the resolved prompt is built
// by buildStoryPrompt; promptInputs — not this body — drive the cache key).
export const STORY_TEMPLATE_BODY = `Tell the story of {{moment}} as an omniscient narrator in 3–8 beats (narration/dialogue/sensory/interior). Ground in {{moment}} + {{neighbors}}; reference related moments by id where genuine. Title + hook + estimatedMinutes.`

export const storySchema = z.object({
  title: z.string().describe('A short, evocative story title.'),
  hook: z.string().describe('One sentence shown on the moment to entice a read.'),
  estimatedMinutes: z.number().int().min(1).max(15),
  segments: z
    .array(
      z.object({
        kind: z.enum(SEGMENT_KINDS),
        bodyText: z.string(),
        settingNote: z.string().nullish().describe('Optional one-line sensory set-dressing for this beat.'),
        relatedNodeIds: z
          .array(z.string())
          .nullish()
          .describe('ids of related moments this beat references — only ids from the provided RELATED MOMENTS list.'),
      }),
    )
    .min(3)
    .max(8),
})

export type StoryObject = z.infer<typeof storySchema>

function describeNode(n: NodeRow): string {
  const date = formatInstant(n.startInstant, n.precision)
  return `- [${n.id}] ${n.type} "${n.title}" (${date})${n.summary ? `: ${n.summary}` : ''}`
}

export function buildStoryPrompt(moment: NodeRow, neighbors: NodeRow[]): string {
  const date = formatInstant(moment.startInstant, moment.precision)
  const neighborList = neighbors.length ? neighbors.map(describeNode).join('\n') : '(none)'
  return `MOMENT:
[${moment.id}] ${moment.type} "${moment.title}" (${date})
${moment.summary ?? '(no summary provided)'}

RELATED MOMENTS (reference by id in a beat's relatedNodeIds only when the beat genuinely touches them):
${neighborList}

Tell this moment's story now.`
}

export type GenerateResult = {
  object: StoryObject
  modelSlug: string
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
}

// Calls the model. The caller (server/stories.ts) handles cache + persistence.
export async function generateStoryObject(moment: NodeRow, neighbors: NodeRow[]): Promise<GenerateResult> {
  const started = Date.now()
  const { object, usage } = await generateObject({
    model: storyModel(),
    schema: storySchema,
    system: STORY_SYSTEM,
    prompt: buildStoryPrompt(moment, neighbors),
  })
  return {
    object,
    modelSlug: STORY_MODEL_SLUG,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    latencyMs: Date.now() - started,
  }
}
