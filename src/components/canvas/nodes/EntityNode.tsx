import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function EntityNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div className="sf-node sf-entity" style={{ width: d.width }}>
      <Handle type="target" position={Position.Left} className="sf-handle" />
      <span className="sf-label">{d.title}</span>
      <Handle type="source" position={Position.Right} className="sf-handle" />
    </div>
  )
}
