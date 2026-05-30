import { useEffect, type ReactNode } from 'react'
import { cn } from '../utils/cn'

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Width preset. */
  size?: 'sm' | 'md' | 'lg'
  /** Optional label for the modal — used as accessible name. */
  'aria-label'?: string
  className?: string
  children: ReactNode
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
}

export function Dialog({
  open,
  onClose,
  size = 'md',
  className,
  children,
  ...rest
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      {...rest}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        className={cn(
          'relative w-full',
          SIZES[size],
          'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)]',
          'border border-[var(--color-border-default)]',
          'shadow-[var(--shadow-overlay)] text-[var(--color-fg-primary)]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'px-5 pt-5 pb-2 text-base font-semibold text-[var(--color-fg-primary)]',
        className,
      )}
    >
      {children}
    </h2>
  )
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-5 py-2 text-sm text-[var(--color-fg-secondary)]', className)}>
      {children}
    </div>
  )
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 px-5 pb-5 pt-3',
        'border-t border-[var(--color-border-subtle)] mt-2',
        className,
      )}
    >
      {children}
    </div>
  )
}
