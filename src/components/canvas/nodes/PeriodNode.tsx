import type { NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

export function PeriodNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div className="sf-period" style={{ width: d.width, borderColor: d.color ?? undefined }}>
        <span className="sf-label">{d.title}</span>
        {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
        {d.storyCount ? <span className="sf-story" title={d.hook ?? 'Story available'}>▶</span> : null}
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
