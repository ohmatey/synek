import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '~/components/client-only'
import { TimelineCanvas } from '~/components/canvas/TimelineCanvas'
import { BuildStreamProvider } from '~/components/canvas/build-stream'
import { ChatPanel } from '~/components/chat/ChatPanel'

export const Route = createFileRoute('/timelines/$id')({
  // `?prompt=` lets the home page kick off the first turn on a freshly created timeline.
  validateSearch: (search: Record<string, unknown>): { prompt?: string } => ({
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
  }),
  component: TimelineView,
})

function TimelineView() {
  const { id } = Route.useParams()
  const { prompt } = Route.useSearch()
  return (
    // Shares in-flight add_node tool calls from the chat to the canvas so nodes
    // appear as the AI places them.
    <BuildStreamProvider>
      <div className="app-shell">
        <main className="canvas-pane">
          {/* React Flow is client-only — guard against SSR. */}
          <ClientOnly fallback={<div className="canvas-loading">Loading canvas…</div>}>
            <TimelineCanvas timelineId={id} />
          </ClientOnly>
        </main>
        <aside className="chat-pane">
          <ChatPanel timelineId={id} initialPrompt={prompt} />
        </aside>
      </div>
    </BuildStreamProvider>
  )
}
