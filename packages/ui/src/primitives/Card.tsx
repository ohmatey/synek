import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual elevation — controls shadow + bg tier. */
  elevation?: 'flat' | 'raised' | 'overlay'
  /** Padding scale. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const ELEVATIONS = {
  flat: 'bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]',
  raised:
    'bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] ' +
    'shadow-[var(--shadow-card)]',
  overlay:
    'bg-[var(--color-bg-overlay)] border border-[var(--color-border-default)] ' +
    'shadow-[var(--shadow-overlay)]',
}

const PADDINGS = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { elevation = 'flat', padding = 'md', className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-card)] text-[var(--color-fg-primary)]',
        ELEVATIONS[elevation],
        PADDINGS[padding],
        className,
      )}
      {...rest}
    />
  )
})
