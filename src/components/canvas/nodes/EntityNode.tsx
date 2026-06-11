import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'
import { PersonCard } from './PersonCard'
import { StoryBadge } from './StoryBadge'

export function EntityNode(props: NodeProps) {
  const d = props.data as CanvasNodeData
  // Person entities render as a portrait polaroid.
  if (d.subtype === 'person') return <PersonCard {...props} />

  // Org entities show their logo inline (contained, not cropped) as a lockup;
  // other entities keep the label bar + image strip below.
  const isOrg = d.subtype === 'org'
  const logo = isOrg ? d.images?.[0] : undefined
  const dateLabel = d.endDate ? `${d.date}–${d.endDate}` : d.date
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div
        className={`sf-entity${isOrg ? ' sf-entity-org' : ''}`}
        style={{ width: d.width, borderColor: d.color ?? undefined }}
      >
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <div className="sf-entity-row">
          {logo ? <img className="sf-logo" src={logo.url} alt={logo.alt ?? ''} /> : null}
          <span className="sf-label">{d.title}</span>
          {dateLabel && <span className="sf-date">{dateLabel}</span>}
          {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
          <StoryBadge data={d} />
        </div>
        {d.summary ? <span className="sf-summary">{d.summary}</span> : null}
        <Handle type="source" position={Position.Right} className="sf-handle" />
      </div>
      {!isOrg && d.images?.length ? (
        <div className="sf-images">
          {d.images.map((im, i) => (
            <img key={i} className={`sf-img${im.aspect === 'portrait' ? ' sf-img-portrait' : ''}`} src={im.url} alt={im.alt ?? ''} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
