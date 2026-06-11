import { useCallback, useRef } from 'react'

// A vertical drag strip pinned to the LEFT edge of a right-docked panel.
// Because the panel is anchored to the right, dragging the handle LEFT grows it
// and dragging RIGHT shrinks it. It reports the proposed new width; the parent
// clamps + persists (onCommit, fired on release). Pointer capture keeps the
// drag alive when the cursor leaves the 6px strip. Arrow keys nudge it for
// keyboard users.
export function ResizeHandle({
  width,
  onResize,
  onCommit,
  label,
  step = 24,
}: {
  width: number
  onResize: (next: number) => void
  onCommit?: () => void
  label: string
  step?: number
}) {
  const start = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      start.current = { x: e.clientX, w: width }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return
      // Anchored right: leftward pointer motion (negative delta) widens it.
      onResize(start.current.w + (start.current.x - e.clientX))
    },
    [onResize],
  )

  const end = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return
      start.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // capture may already be gone
      }
      onCommit?.()
    },
    [onCommit],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(width + step)
        onCommit?.()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(width - step)
        onCommit?.()
      }
    },
    [width, step, onResize, onCommit],
  )

  return (
    <div
      className="panel-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  )
}
