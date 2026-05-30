import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'story'
  | 'influence'
  | 'dialogue'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  /** Renders as a filled chip vs an outlined chip. */
  appearance?: 'solid' | 'soft' | 'outline'
}

const VARIANT_COLOR: Record<BadgeVariant, string> = {
  neutral: 'var(--color-fg-secondary)',
  primary: 'var(--color-accent-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  story: 'var(--color-accent-story)',
  influence: 'var(--color-accent-influence)',
  dialogue: 'var(--color-accent-dialogue)',
}

const VARIANT_SOFT_BG: Record<BadgeVariant, string> = {
  neutral: 'var(--color-bg-elevated)',
  primary: 'var(--color-primary-soft)',
  success: 'var(--color-success-soft)',
  warning: 'var(--color-story-soft)',
  danger: 'var(--color-danger-soft-bg)',
  story: 'var(--color-story-soft)',
  influence: 'var(--color-influence-soft)',
  dialogue: 'var(--color-dialogue-soft)',
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'neutral', appearance = 'soft', className, style, ...rest },
  ref,
) {
  const color = VARIANT_COLOR[variant]
  const styleByAppearance =
    appearance === 'solid'
      ? { background: color, color: 'var(--color-on-accent)', border: '1px solid transparent' }
      : appearance === 'outline'
        ? { background: 'transparent', color, border: `1px solid ${color}` }
        : { background: VARIANT_SOFT_BG[variant], color, border: '1px solid transparent' }

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5',
        'text-[11px] font-medium leading-none whitespace-nowrap',
        className,
      )}
      style={{ ...styleByAppearance, ...style }}
      {...rest}
    />
  )
})
