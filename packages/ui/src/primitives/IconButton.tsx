import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export type IconButtonVariant = 'default' | 'ghost' | 'primary' | 'danger'
export type IconButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for a11y — describes what the button does. */
  'aria-label': string
  variant?: IconButtonVariant
  size?: IconButtonSize
}

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7 [&_svg]:size-3.5',
  md: 'h-9 w-9 [&_svg]:size-4',
  lg: 'h-11 w-11 [&_svg]:size-5',
}

const VARIANTS: Record<IconButtonVariant, string> = {
  default:
    'bg-[var(--color-bg-surface)] text-[var(--color-fg-secondary)] ' +
    'border-[var(--color-border-default)] ' +
    'hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)]',
  ghost:
    'bg-transparent text-[var(--color-fg-secondary)] border-transparent ' +
    'hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)]',
  primary:
    'bg-[var(--color-accent-primary)] text-[var(--color-on-accent)] border-transparent ' +
    'hover:brightness-110',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-on-accent)] border-transparent ' +
    'hover:brightness-110',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'default', size = 'md', className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] border transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
