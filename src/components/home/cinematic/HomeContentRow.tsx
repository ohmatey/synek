import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// A horizontal scroll-snap carousel row (Wren §5): a label, desktop-only arrow
// buttons (hidden on touch via the .ch-row-arrows @media(hover:none) CSS), and a
// scroll-snapping track. No carousel library — the arrows scrollBy ~one viewport's
// worth. The global styles.css reduced-motion reset can't reach an imperative
// scrollBy({behavior:'smooth'}), so we check the media query and pass
// behavior:'auto' (instant) when the user prefers reduced motion.
export function HomeContentRow({
  title,
  action,
  children,
}: {
  title: string
  // Optional trailing action (e.g. a "New" button) shown beside the row arrows.
  action?: ReactNode
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <section className="ch-row" aria-label={title}>
      <header className="ch-row-head">
        <h2 className="ch-row-title">{title}</h2>
        <div className="ch-row-head-actions">
          <div className="ch-row-arrows" aria-hidden="true">
            <button
              type="button"
              className="ch-arrow"
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${title} left`}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className="ch-arrow"
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${title} right`}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          {action}
        </div>
      </header>
      <div className="ch-track" ref={trackRef}>
        {children}
      </div>
    </section>
  )
}
