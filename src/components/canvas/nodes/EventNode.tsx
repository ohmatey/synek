import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'
import { StoryBadge } from './StoryBadge'

// The head/meta wrappers are `display: contents` in the default horizontal pill,
// so the flat nowrap row is unchanged; in the vertical variant they become the
// two stacked lines (title above date+badges). See `.sf-event-vertical`.
//
// An event with an `end` is drawn at its SPAN width, like every other spanned
// node. This used to be the one type that ignored `d.width` entirely, while the
// lane packer already reserved span width for it (TimelineCanvas `widthOf`) — so
// a spanned event reserved a wide slot and then drew a narrow content-width pill
// inside it, leaving a gap the packer refused to fill. Spanless events keep their
// text-driven width (`d.width` is undefined for them).
export function EventNode({ data }: NodeProps) {
  const d = data as CanvasNodeData
  const vertical = d.orientation === 'vertical'
  const spanned = d.endDate != null && d.width != null
  return (
    <div className={`sf-node sf-size-${d.size ?? 'medium'}`}>
      <div
        className={`sf-event${d.hasSummary ? ' sf-event-rich' : ''}${vertical ? ' sf-event-vertical' : ''}${spanned ? ' sf-event-spanned' : ''}`}
        style={spanned ? { width: d.width } : undefined}
        title={d.hasSummary ? 'Has a description — click to read' : undefined}
      >
        <Handle type="target" position={Position.Left} className="sf-handle" />
        <div className="sf-event-head">
          <span className="sf-dot" style={d.color ? { background: d.color } : undefined} aria-hidden />
          <span className="sf-label">{d.title}</span>
        </div>
        <div className="sf-event-meta">
          {d.date && <span className="sf-date">{d.date}</span>}
          {d.hasSummary ? (
            <svg className="sf-event-note" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zm0 0v5h5M8 13h8M8 17h6"
              />
            </svg>
          ) : null}
          {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
          <StoryBadge data={d} />
        </div>
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
