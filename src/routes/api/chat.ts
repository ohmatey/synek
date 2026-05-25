import { createFileRoute } from '@tanstack/react-router'

// Phase 0 implements the streamText + tool loop here (see CLAUDE.md → AI loop):
// load the graph for the timeline, run streamText with makeTools(builder) and
// stopWhen(stepCountIs(...)), commit the builder as ONE Patch, then return
// result.toUIMessageStreamResponse(). For now this is a stub so the app boots.
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async () => {
        return Response.json(
          { error: 'Not implemented yet — the AI chat loop lands in Phase 0.' },
          { status: 501 },
        )
      },
    },
  },
})
