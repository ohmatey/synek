import { createOpenAI } from '@ai-sdk/openai'

// OpenRouter as the default multi-provider gateway. Core is bring-your-own-key.
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
})

const DEFAULT_MODEL = process.env.STRATA_MODEL || 'anthropic/claude-sonnet-4-6'

// `.chat()` selects the OpenAI-compatible chat-completions API, which OpenRouter speaks.
export function model(slug: string = DEFAULT_MODEL) {
  return openrouter.chat(slug)
}
