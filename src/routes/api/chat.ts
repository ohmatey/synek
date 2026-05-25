import { createFileRoute } from '@tanstack/react-router'
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai'
import { model } from '~/lib/ai/provider'
import { systemPrompt } from '~/lib/ai/prompt'
import { makeTools } from '~/lib/ai/tools'
import { ensureTimeline } from '~/lib/db/graph'

// The AI engine. One user turn → many tool calls (multi-step) → graph mutations.
// In Phase 0 tools write straight to the DB; Phase 1 wraps them in one atomic Patch.
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env.OPENROUTER_API_KEY) {
          return Response.json(
            { error: 'Set OPENROUTER_API_KEY in .env (copy .env.example) to chat with the timeline.' },
            { status: 400 },
          )
        }

        const { messages, timelineId = 'default' } = (await request.json()) as {
          messages: UIMessage[]
          timelineId?: string
        }

        ensureTimeline(timelineId)

        const result = streamText({
          model: model(),
          system: systemPrompt(),
          messages: await convertToModelMessages(messages),
          tools: makeTools({ timelineId }),
          stopWhen: stepCountIs(16),
        })

        return result.toUIMessageStreamResponse()
      },
    },
  },
})
