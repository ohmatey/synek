import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ClientOnly } from '~/components/client-only'
import { TimelineCanvas } from '~/components/canvas/TimelineCanvas'
import { BuildStreamProvider } from '~/components/canvas/build-stream'

// Deep-linkable canvas state, kept in the URL so a view can be bookmarked, shared,
// and restored across reloads (and handed back by the MCP client as a precise link).
// Each field `.catch`es to undefined on its own, so a stale/garbage param degrades
// gracefully — bad `view` → timeline, unknown `node`/`story` id → nothing selected
// (the canvas is live, so an id may simply not exist yet while an MCP build streams).
const searchSchema = z.object({
  view: z.enum(['timeline', 'globe', 'stories']).optional().catch(undefined),
  node: z.string().optional().catch(undefined),
  story: z.string().optional().catch(undefined),
  // When opening a story from the home, skip the reader's cover and start stepping
  // immediately (the home's intro dialog already served as the cover).
  autoplay: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/timelines/$id')({
  validateSearch: searchSchema,
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
