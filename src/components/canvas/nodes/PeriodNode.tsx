import type { NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function PeriodNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div className="sf-node sf-period" style={{ width: d.width }}>
      <span className="sf-label">{d.title}</span>
    </div>
  )
}
