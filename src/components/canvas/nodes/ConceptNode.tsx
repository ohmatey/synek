import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Lightbulb } from 'lucide-react'
import type { CanvasNodeData } from '../types'

// An idea/doctrine, not a point in time or an actor: a soft "idea" chip carrying
// the concept's definition as its body. A lightbulb marker distinguishes it from
// entities at a glance.
export function ConceptNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  const dateLabel = d.endDate ? `${d.date}–${d.endDate}` : d.date
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div className="sf-concept" style={{ width: d.width, borderColor: d.color ?? undefined }}>
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <div className="sf-entity-row">
          <Lightbulb className="sf-concept-icon" aria-hidden />
          <span className="sf-label">{d.title}</span>
          {dateLabel && <span className="sf-date">{dateLabel}</span>}
          {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
        </div>
        {d.summary ? <span className="sf-summary">{d.summary}</span> : null}
        <Handle type="source" position={Position.Right} className="sf-handle" />
      </div>
    </div>
  )
}
