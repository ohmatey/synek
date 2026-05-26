import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

// A "polaroid" card for person entities: a framed portrait on top, with a
// name + date plate beneath. Fixed-size (anchored at the start instant), so the
// lifespan reads as the caption dates rather than a stretched span bar.
export function PersonCard({ data }: NodeProps) {
  const d = data as CanvasNodeData
  // CanvasNodeData.images is already filtered to the shown ones.
  const portrait = d.images?.[0]
  return (
    <div
      className={`sf-node sf-person sf-size-${d.size ?? 'medium'}`}
      style={{ width: d.width, borderColor: d.color ?? undefined }}
    >
      <Handle type="target" position={Position.Left} className="sf-handle" />
      <div className="sf-person-frame">
        {portrait ? (
          <img className="sf-person-portrait" src={portrait.url} alt={portrait.alt ?? d.title} />
        ) : (
          <svg className="sf-person-empty" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.6-8 5.8V22h16v-2.2c0-3.2-3.6-5.8-8-5.8Z"
            />
          </svg>
        )}
      </div>
      <div className="sf-person-plate" style={d.color ? { borderTopColor: d.color } : undefined}>
        <span className="sf-person-name">{d.title}</span>
        {d.date && <span className="sf-person-dates">{d.date}</span>}
      </div>
      {(d.citations || d.storyCount) ? (
        <div className="sf-person-badges">
          {d.citations ? (
            <span className="sf-cite" title={`${d.citations} citation(s)`}>
              {d.citations}
            </span>
          ) : null}
          {d.storyCount ? (
            <span className="sf-story" title={d.hook ?? 'Story available'}>
              ▶
            </span>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="sf-handle" />
    </div>
  )
}
