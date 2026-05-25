import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function EventNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div className="sf-event" style={d.color ? { borderColor: d.color } : undefined}>
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <span className="sf-dot" style={d.color ? { background: d.color } : undefined} aria-hidden />
        <span className="sf-label">{d.title}</span>
        {d.date && <span className="sf-date">{d.date}</span>}
        {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
        {d.storyCount ? <span className="sf-story" title={d.hook ?? 'Story available'}>▶</span> : null}
        <Handle type="source" position={Position.Right} className="sf-handle" />
      </div>
      {d.images?.length ? (
        <div className="sf-images">
          {d.images.map((im, i) => (
            <img key={i} className="sf-img" src={im.url} alt={im.alt ?? ''} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
