import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'
import { PersonCard } from './PersonCard'

export function EntityNode(props: NodeProps) {
  const d = props.data as CanvasNodeData
  // Person entities render as a portrait polaroid.
  if (d.subtype === 'person') return <PersonCard {...props} />

  // Org entities show their logo inline (contained, not cropped) as a lockup;
  // other entities keep the label bar + image strip below.
  const isOrg = d.subtype === 'org'
  const logo = isOrg ? d.images?.[0] : undefined
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div
        className={`sf-entity${isOrg ? ' sf-entity-org' : ''}`}
        style={{ width: d.width, borderColor: d.color ?? undefined }}
      >
        <Handle type="target" position={Position.Left} className="sf-handle" />
        {logo ? <img className="sf-logo" src={logo.url} alt={logo.alt ?? ''} /> : null}
        <span className="sf-label">{d.title}</span>
        {d.date && <span className="sf-date">{d.date}</span>}
        {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
        {d.storyCount ? <span className="sf-story" title={d.hook ?? 'Story available'}>▶</span> : null}
        <Handle type="source" position={Position.Right} className="sf-handle" />
      </div>
      {!isOrg && d.images?.length ? (
        <div className="sf-images">
          {d.images.map((im, i) => (
            <img key={i} className="sf-img" src={im.url} alt={im.alt ?? ''} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
