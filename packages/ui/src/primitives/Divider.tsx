import { cn } from '../utils/cn'

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <span
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'block bg-[var(--color-border-subtle)]',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className,
      )}
    />
  )
}
