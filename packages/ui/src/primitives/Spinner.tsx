import { cn } from '../utils/cn'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Accessible label. Defaults to 'Loading'. */
  label?: string
}

const SIZES = {
  sm: 'h-3 w-3 border-[1.5px]',
  md: 'h-4 w-4 border-2',
  lg: 'h-6 w-6 border-2',
}

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block rounded-full border-current border-r-transparent animate-spin',
        SIZES[size],
        className,
      )}
    />
  )
}
