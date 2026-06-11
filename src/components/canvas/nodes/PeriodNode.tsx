import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { CanvasNodeData } from '../types'
import { StoryBadge } from './StoryBadge'

export function PeriodNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  const span = d.endDate ? `${d.date}–${d.endDate}` : d.date
  // Era tint rides on a CSS custom property so `.sf-period` keeps its purple
  // fallback for periods without one (e.g. optimistic pending nodes).
  // Accent rides the left rail (era token by default; the node's own color when
  // set), not the whole perimeter.
  const periodStyle: CSSProperties = { width: d.width, borderLeftColor: d.color ?? undefined }
  if (d.tint) (periodStyle as Record<string, string | number | undefined>)['--sf-era-tint'] = d.tint
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div className="sf-period" style={periodStyle}>
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <span className="sf-label">{d.title}</span>
        {d.summary ? <span className="sf-summary">{d.summary}</span> : null}
        {span ? <span className="sf-period-span">{span}</span> : null}
        {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
        <StoryBadge data={d} />
        <Handle type="source" position={Position.Right} className="sf-handle" />
      </div>
      {d.images?.length ? (
        <div className="sf-images">
          {d.images.map((im, i) => (
            <img key={i} className={`sf-img${im.aspect === 'portrait' ? ' sf-img-portrait' : ''}`} src={im.url} alt={im.alt ?? ''} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
