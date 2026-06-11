import { Filter } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/utils'
import { floatChip } from './chrome'

// All filterable kinds, in display order. `token` matches kindToken() in
// TimelineCanvas (entity nodes filter by subtype; type otherwise). Only kinds
// actually present in the timeline get a row.
const KIND_META: { token: string; label: string; color: string }[] = [
  { token: 'period', label: 'Periods', color: 'var(--color-accent-influence)' },
  { token: 'event', label: 'Events', color: 'var(--color-accent-primary)' },
  { token: 'concept', label: 'Concepts', color: 'var(--color-accent-dialogue)' },
  { token: 'person', label: 'People', color: 'var(--color-fg-secondary)' },
  { token: 'org', label: 'Orgs', color: 'var(--color-fg-secondary)' },
  { token: 'place', label: 'Places', color: 'var(--color-fg-secondary)' },
  { token: 'work', label: 'Works', color: 'var(--color-fg-secondary)' },
  { token: 'entity', label: 'Entities', color: 'var(--color-fg-secondary)' },
]

// Floating "filter" chip → popover of per-kind visibility toggles. View-only
// (session state in the parent); hiding a kind drops its nodes from the layout
// and dims edges that touch them.
export function FilterControls({
  counts,
  hiddenKinds,
  onToggle,
  onReset,
}: {
  counts: Map<string, number>
  hiddenKinds: Set<string>
  onToggle: (token: string) => void
  onReset: () => void
}) {
  const present = KIND_META.filter((k) => (counts.get(k.token) ?? 0) > 0)
  const hiddenCount = hiddenKinds.size

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn('relative size-8', floatChip, hiddenCount > 0 && 'text-amber-600 dark:text-amber-400')}
          title="Filter by kind"
          aria-label="Filter by kind"
          data-testid="canvas-filter"
        >
          <Filter />
          {hiddenCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
              {hiddenCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Show on timeline
            </span>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                onClick={onReset}
              >
                Reset
              </button>
            )}
          </div>
          <Separator />
          <div className="flex flex-col gap-1">
            {present.map((k) => {
              const visible = !hiddenKinds.has(k.token)
              return (
                <Button
                  key={k.token}
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 justify-start gap-2 px-2 text-xs', !visible && 'opacity-45')}
                  aria-pressed={visible}
                  data-testid={`filter-kind-${k.token}`}
                  onClick={() => onToggle(k.token)}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: visible ? k.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${k.color}` }}
                    aria-hidden
                  />
                  <span className="flex-1 text-left">{k.label}</span>
                  <span className="tabular-nums text-muted-foreground">{counts.get(k.token) ?? 0}</span>
                </Button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
