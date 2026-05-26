import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '~/components/client-only'
import { TimelineCanvas } from '~/components/canvas/TimelineCanvas'
import { BuildStreamProvider } from '~/components/canvas/build-stream'

export const Route = createFileRoute('/timelines/$id')({
  component: TimelineView,
})

function TimelineView() {
  const { id } = Route.useParams()
  return (
    <BuildStreamProvider>
      <div className="app-shell">
        <main className="canvas-pane">
          {/* React Flow is client-only — guard against SSR. */}
          <ClientOnly fallback={<div className="canvas-loading">Loading canvas…</div>}>
            <TimelineCanvas timelineId={id} />
          </ClientOnly>
        </main>
      </div>
    </BuildStreamProvider>
  )
}
