import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../utils/cn'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Renders as <aside> instead of <section>. */
  as?: 'section' | 'aside' | 'div'
  /** Optional title rendered at the top of the panel. */
  title?: React.ReactNode
  /** Optional actions rendered on the right of the title bar. */
  actions?: React.ReactNode
}

/**
 * Larger structural surface for dock-style overlays — node detail panel, chat,
 * etc. Has its own scrolling region. Use Card for smaller composable surfaces.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { as = 'section', title, actions, className, children, ...rest },
  ref,
) {
  const Tag = as as 'section'
  return (
    <Tag
      ref={ref as React.Ref<HTMLElement>}
      className={cn(
        'flex flex-col overflow-hidden',
        'bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]',
        'rounded-[var(--radius-card)] shadow-[var(--shadow-panel)]',
        'text-[var(--color-fg-primary)]',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <header
          className={cn(
            'flex items-center justify-between gap-2 px-4 py-3',
            'border-b border-[var(--color-border-subtle)]',
          )}
        >
          {title && (
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)] truncate">
              {title}
            </h3>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </Tag>
  )
})
