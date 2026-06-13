import { BookOpen, CalendarClock, Globe } from 'lucide-react'
import { cn } from '~/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { floatChip } from './chrome'
import type { GlobeCoverage } from './globe-coverage'

export type CanvasView = 'timeline' | 'globe' | 'stories'

// The top-center lens toggle (docs/product/prd/globe-lens.md §Entry). ALWAYS rendered —
// the Timeline | Globe control is a permanent fixture of the app bar, so the globe is
// discoverable even before any node carries coordinates. The Globe segment never calls
// onChange('globe') directly: it defers to `onSwitchToGlobe`, which the parent wires so
// that a timeline with no located nodes opens the setup/backfill prompt instead of an
// empty globe; once coordinates exist it switches. Below the coverage gate the Globe
// segment carries a tooltip explaining the gap. Read-only navigation — shown for owner
// and public viewer alike.
export function ViewSwitcher({
  view,
  onChange,
  onSwitchToGlobe,
  coverage,
}: {
  view: CanvasView
  onChange: (v: CanvasView) => void
  // Clicking Globe routes through here (not onChange) so the parent can decide
  // between switching and opening the backfill prompt based on coverage.
  onSwitchToGlobe: () => void
  coverage: GlobeCoverage
}) {
  const globeBtn = (
    <button
      type="button"
      role="radio"
      aria-checked={view === 'globe'}
      data-active={view === 'globe' || undefined}
      className="view-switch-btn"
      onClick={onSwitchToGlobe}
    >
      <Globe size={14} />
      Globe
    </button>
  )

  return (
    <div className={cn(floatChip, 'view-switcher')} role="radiogroup" aria-label="Canvas view">
      <button
        type="button"
        role="radio"
        aria-checked={view === 'timeline'}
        data-active={view === 'timeline' || undefined}
        className="view-switch-btn"
        onClick={() => onChange('timeline')}
      >
        <CalendarClock size={14} />
        Timeline
      </button>
      {coverage.sufficient ? (
        globeBtn
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{globeBtn}</TooltipTrigger>
          <TooltipContent>
            {coverage.hasAny
              ? `${coverage.located} of ${coverage.total - coverage.placeless} placeable nodes are on the map` +
                (coverage.placeless ? ` (${coverage.placeless} have no single place)` : '') +
                ' — add more for a fuller picture.'
              : 'No map coordinates yet — set up the globe view.'}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Stories lens — the narrative view. No coverage gate (the empty state IS
          the UX), so it switches directly. Replaces the old AppBar Stories popover. */}
      <button
        type="button"
        role="radio"
        aria-checked={view === 'stories'}
        data-active={view === 'stories' || undefined}
        className="view-switch-btn"
        onClick={() => onChange('stories')}
      >
        <BookOpen size={14} />
        Stories
      </button>
    </div>
  )
}
