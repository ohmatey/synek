import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function PeriodNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  const span = d.endDate ? `${d.date}–${d.endDate}` : d.date
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div className="sf-period" style={{ width: d.width, borderColor: d.color ?? undefined }}>
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <span className="sf-label">{d.title}</span>
        {d.summary ? <span className="sf-summary">{d.summary}</span> : null}
        {span ? <span className="sf-period-span">{span}</span> : null}
        {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
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
