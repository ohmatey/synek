import { Suspense, lazy } from 'react'
import { ClientOnly } from '@synek/ui'
import { cn } from '~/lib/utils'
import type { GraphNode, StoryBeatWidget } from '~/lib/domain/types'
import { EntityCardWidget } from './EntityCardWidget'
import { TimelineStripWidget } from './TimelineStripWidget'

// d3-geo + the world TopoJSON are heavy — load the globe widget only when a beat
// actually uses one (and only on the client; it measures + projects).
const GlobeMiniWidget = lazy(() => import('./GlobeMiniWidget'))

// Resolve a beat's widget spec against the nodes the public loader shipped, then
// render the matching mini-view. Renders nothing when no referenced node resolves
// (a widget pointing at deleted nodes degrades to a text-only beat, not a crash).
export function BeatWidget({
  widget,
  nodeById,
}: {
  widget: StoryBeatWidget
  nodeById: Map<string, GraphNode>
}) {
  const nodes = widget.nodeIds.map((id) => nodeById.get(id)).filter((n): n is GraphNode => !!n)
  if (nodes.length === 0) return null
  const focus = (widget.focusNodeId && nodeById.get(widget.focusNodeId)) || nodes[0]!

  let body: React.ReactNode = null
  if (widget.kind === 'entity') {
    body = <EntityCardWidget node={focus} />
  } else if (widget.kind === 'timeline') {
    body = <TimelineStripWidget nodes={nodes} focusId={focus.id} />
  } else if (widget.kind === 'globe') {
    const placed = nodes.filter((n) => typeof n.lat === 'number' && typeof n.lng === 'number')
    if (placed.length === 0) return null
    body = (
      <ClientOnly fallback={<div className="wg-globe wg-globe-skeleton" aria-hidden="true" />}>
        <Suspense fallback={<div className="wg-globe wg-globe-skeleton" aria-hidden="true" />}>
          <GlobeMiniWidget nodes={placed} focusId={focus.id} />
        </Suspense>
      </ClientOnly>
    )
  }

  return (
    <div className={cn('wg', `wg-${widget.kind}-wrap`)}>
      {body}
      {widget.caption && <p className="wg-caption">{widget.caption}</p>}
    </div>
  )
}
