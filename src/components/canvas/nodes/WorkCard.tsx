import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'
import { StoryBadge } from './StoryBadge'

// A "cover" card for work entities (books, artworks, documents): the first
// shown image framed as a cover on top, title + date plate beneath. Fixed-size
// (anchored at the start instant) like the person polaroid — a work's span
// (e.g. years of composition) reads as the caption dates, not a stretched bar
// that crushes the card at low zoom.
export function WorkCard({ data }: NodeProps) {
  const d = data as CanvasNodeData
  const cover = d.images?.[0]
  // Covers default to a slightly-landscape frame (paintings, scenes); a
  // portrait cover (manuscript page, book jacket) makes the frame taller.
  const aspect = cover?.aspect === 'portrait' ? 'portrait' : 'landscape'
  return (
    <div className={`sf-node sf-work sf-size-${d.size ?? 'medium'}`} style={{ width: d.width }}>
      <Handle type="target" position={Position.Left} className="sf-handle" />
      <div className={`sf-work-frame sf-work-frame-${aspect}`}>
        {cover ? (
          <img className="sf-work-cover" src={cover.url} alt={cover.alt ?? d.title} />
        ) : (
          <svg className="sf-work-empty" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M7.5 2A2.5 2.5 0 0 0 5 4.5v15A2.5 2.5 0 0 0 7.5 22H19a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H7.5ZM7.5 18H18v2H7.5a1 1 0 0 1 0-2Z"
            />
          </svg>
        )}
        {/* Identity accent as a spine rail on the frame's left edge (carrier
            accent, not a perimeter) — works read as bound volumes. */}
        {d.color ? <span className="sf-work-spine" style={{ background: d.color }} aria-hidden /> : null}
      </div>
      <div className="sf-work-plate">
        <span className="sf-work-title">{d.title}</span>
        {d.date && <span className="sf-work-dates">{d.endDate ? `${d.date}–${d.endDate}` : d.date}</span>}
        {d.summary ? <span className="sf-summary">{d.summary}</span> : null}
      </div>
      {d.citations || d.hasStory ? (
        <div className="sf-work-badges">
          {d.citations ? <span className="sf-cite" title={`${d.citations} citation(s)`}>{d.citations}</span> : null}
          <StoryBadge data={d} />
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="sf-handle" />
    </div>
  )
}
