import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Renders a red invalid border. */
  invalid?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-4 text-base',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = 'md', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-[var(--radius-control)]',
        'bg-[var(--color-bg-base)] text-[var(--color-fg-primary)]',
        'border transition-colors',
        invalid
          ? 'border-[var(--color-danger)]'
          : 'border-[var(--color-border-default)] hover:border-[var(--color-fg-subtle)]',
        'placeholder:text-[var(--color-fg-subtle)]',
        'focus:outline-none focus:border-[var(--color-accent-primary)]',
        'focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-0',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZES[size],
        className,
      )}
      {...rest}
    />
  )
})
