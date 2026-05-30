import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-[var(--radius-control)] px-3 py-2 text-sm',
        'bg-[var(--color-bg-base)] text-[var(--color-fg-primary)]',
        'border transition-colors resize-y',
        invalid
          ? 'border-[var(--color-danger)]'
          : 'border-[var(--color-border-default)] hover:border-[var(--color-fg-subtle)]',
        'placeholder:text-[var(--color-fg-subtle)]',
        'focus:outline-none focus:border-[var(--color-accent-primary)]',
        'focus:ring-2 focus:ring-[var(--color-focus-ring)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    />
  )
})
