import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

// A typed relationship edge whose label sits BESIDE the curve, not on it.
//
// React Flow's built-in `label` prop pins the text to the bezier midpoint, which
// on a timeline is exactly where a node sits: two moments days apart on the axis
// but in different lanes make a curve that loops back across every row between
// them, and the midpoint lands on one of those rows.
//
// The canvas already knows every node's rect, so it solves the placement once per
// layout (`placeEdgeLabel` in useTimelineScale) and hands the result down as
// `labelX`/`labelY`. This component stays a dumb presenter — no store reads.
export type LabeledEdgeData = {
  label: string
  color: string
  opacity: number
  // Absolute flow coords for the label, precomputed by the layout. Falls back to
  // the bezier midpoint when absent.
  labelX?: number
  labelY?: number
}

function LabeledEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const d = data as LabeledEdgeData | undefined
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const lx = d?.labelX ?? midX
  const ly = d?.labelY ?? midY - 18

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {d?.label ? (
        <EdgeLabelRenderer>
          <div
            // nodrag/nopan + pointer-events:none: the label must never swallow a
            // canvas pan or a click meant for the node behind it.
            className="sf-edge-label nodrag nopan"
            // Long labels ellipsize (see `.sf-edge-label`), so keep the full text
            // reachable on hover.
            title={d.label}
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              color: d.color,
              opacity: d.opacity,
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const LabeledEdge = memo(LabeledEdgeImpl)
