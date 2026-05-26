import { createOpenAI } from '@ai-sdk/openai'

// OpenRouter as the default multi-provider gateway. Core is bring-your-own-key.
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
})

// gpt-image-1 is NOT served by OpenRouter, so image generation talks to OpenAI
// directly. Separate key from the chat gateway.
const openaiDirect = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const DEFAULT_MODEL = process.env.STRATA_MODEL || 'anthropic/claude-sonnet-4-6'

export const IMAGE_MODEL_SLUG = process.env.STRATA_IMAGE_MODEL || 'gpt-image-1'

// Story generation gets its own knob — storytelling and tool-following reward
// different models. Falls back to the graph model when unset (point it at a
// stronger model, e.g. anthropic/claude-opus-4-7, for richer prose).
export const STORY_MODEL_SLUG = process.env.STRATA_STORY_MODEL || DEFAULT_MODEL

// `.chat()` selects the OpenAI-compatible chat-completions API, which OpenRouter speaks.
export function model(slug: string = DEFAULT_MODEL) {
  return openrouter.chat(slug)
}

export function storyModel(slug: string = STORY_MODEL_SLUG) {
  return openrouter.chat(slug)
}

export function imageModel(slug: string = IMAGE_MODEL_SLUG) {
  return openaiDirect.image(slug)
}
