import { useThemeContext } from './ThemeProvider'
import type { Theme } from './types'
import { cn } from '../utils/cn'

const ORDER: Theme[] = ['system', 'light', 'dark']

const NEXT_LABEL: Record<Theme, string> = {
  system: 'Switch to light',
  light: 'Switch to dark',
  dark: 'Switch to system',
}

// Cycle: system → light → dark → system.
function next(t: Theme): Theme {
  return ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]
}

function Icon({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    // Half-circle (auto)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2 a6 6 0 0 0 0 12 z" fill="currentColor" />
      </svg>
    )
  }
  if (theme === 'light') {
    // Sun
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="8" y1="1.5" x2="8" y2="3.2" />
          <line x1="8" y1="12.8" x2="8" y2="14.5" />
          <line x1="1.5" y1="8" x2="3.2" y2="8" />
          <line x1="12.8" y1="8" x2="14.5" y2="8" />
          <line x1="3.4" y1="3.4" x2="4.6" y2="4.6" />
          <line x1="11.4" y1="11.4" x2="12.6" y2="12.6" />
          <line x1="3.4" y1="12.6" x2="4.6" y2="11.4" />
          <line x1="11.4" y1="4.6" x2="12.6" y2="3.4" />
        </g>
      </svg>
    )
  }
  // Moon
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        d="M13 9.5 A6 6 0 1 1 6.5 3 a5 5 0 0 0 6.5 6.5 z"
        fill="currentColor"
      />
    </svg>
  )
}

export interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useThemeContext()
  return (
    <button
      type="button"
      onClick={() => setTheme(next(theme))}
      aria-label={NEXT_LABEL[theme]}
      title={NEXT_LABEL[theme]}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]',
        'border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]',
        'text-[var(--color-fg-secondary)] transition-colors',
        'hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
        className,
      )}
    >
      <Icon theme={theme} />
    </button>
  )
}
