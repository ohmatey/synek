import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function EventNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div className="sf-node sf-event">
      <Handle type="target" position={Position.Left} className="sf-handle" />
      <span className="sf-dot" aria-hidden />
      <span className="sf-label">{d.title}</span>
      {d.date && <span className="sf-date">{d.date}</span>}
      <Handle type="source" position={Position.Right} className="sf-handle" />
    </div>
  )
}
