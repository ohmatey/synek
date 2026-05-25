import { createFileRoute } from '@tanstack/react-router'
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai'
import { model } from '~/lib/ai/provider'
import { systemPrompt } from '~/lib/ai/prompt'
import { makeTools } from '~/lib/ai/tools'
import { ensureTimeline, loadGraph } from '~/lib/db/graph'
import { PatchBuilder, commitPatch } from '~/lib/db/patches'
import { saveMessages } from '~/lib/db/messages'
import { createSession, getSession, renameSession, touchSession, DEFAULT_SESSION_TITLE } from '~/lib/db/sessions'

// The AI engine. One user turn → many tool calls → ops buffered on a
// PatchBuilder → committed as ONE atomic, undoable Patch when the stream ends.
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

        const { messages, timelineId = 'default', sessionId: bodySessionId } = (await request.json()) as {
          messages: UIMessage[]
          timelineId?: string
          sessionId?: string
        }

        ensureTimeline(timelineId)
        // Trust the client's thread id; create one if a request arrives without it.
        const sessionId = bodySessionId || createSession(timelineId).id
        const graph = loadGraph(timelineId)
        const builder = new PatchBuilder(timelineId, graph)

        const result = streamText({
          model: model(),
          system: systemPrompt(graph),
          messages: await convertToModelMessages(messages),
          tools: makeTools(builder),
          stopWhen: stepCountIs(16),
          // better-sqlite3 is synchronous, so this commits before the stream
          // closes — the client's refetch on finish sees the new graph.
          onFinish: ({ text }) => {
            commitPatch(timelineId, builder, (text || 'AI turn').slice(0, 200))
          },
        })

        // Persist the full updated transcript so reloading restores the chat
        // alongside the canvas it built.
        return result.toUIMessageStreamResponse({
          onFinish: ({ messages: finalMessages }) => {
            saveMessages(
              sessionId,
              timelineId,
              finalMessages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
            )
            touchSession(sessionId)
            // Name a still-default thread after its opening user message (for History).
            if (getSession(sessionId)?.title === DEFAULT_SESSION_TITLE) {
              const opener = finalMessages.find((m) => m.role === 'user')
              const text = opener?.parts
                .map((p) => (p.type === 'text' ? p.text : ''))
                .join(' ')
                .trim()
              if (text) renameSession(sessionId, text.length > 60 ? `${text.slice(0, 59)}…` : text)
            }
          },
          // Surface a readable reason instead of the default masked "An error
          // occurred" so the chat can show what actually went wrong.
          onError: (error) =>
            error instanceof Error ? error.message : 'The timeline build failed — please try again.',
        })
      },
    },
  },
})
