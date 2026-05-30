import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../utils/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and disables the button. */
  loading?: boolean
  /** Optional leading icon (rendered before children). */
  leading?: React.ReactNode
  /** Optional trailing icon (rendered after children). */
  trailing?: React.ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium ' +
  'rounded-[var(--radius-control)] transition-colors select-none ' +
  'border focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--color-focus-ring)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-base',
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent-primary)] text-[var(--color-on-accent)] border-transparent ' +
    'hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[var(--color-bg-surface)] text-[var(--color-fg-primary)] ' +
    'border-[var(--color-border-default)] hover:bg-[var(--color-bg-elevated)]',
  ghost:
    'bg-transparent text-[var(--color-fg-secondary)] border-transparent ' +
    'hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)]',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-on-accent)] border-transparent ' +
    'hover:brightness-110 active:brightness-95',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leading,
    trailing,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      className={cn(BASE, SIZES[size], VARIANTS[variant], className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : leading}
      {children}
      {!loading && trailing}
    </button>
  )
})
