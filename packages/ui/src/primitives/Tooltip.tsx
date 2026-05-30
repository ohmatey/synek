import { useRef, useState, type ReactNode } from 'react'
import { cn } from '../utils/cn'

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  /** Show delay in ms. Default 200. */
  delay?: number
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

const SIDE_POS: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1',
}

/**
 * Lightweight tooltip — pure hover/focus, no portal. For complex positioning
 * (collision avoidance, etc.) reach for a popper lib later.
 */
export function Tooltip({ content, children, delay = 200, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    if (t.current) clearTimeout(t.current)
    setOpen(false)
  }

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap',
            'rounded-md border border-[var(--color-border-default)]',
            'bg-[var(--color-bg-overlay)] px-2 py-1 text-xs',
            'text-[var(--color-fg-primary)] shadow-[var(--shadow-overlay)]',
            SIDE_POS[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
