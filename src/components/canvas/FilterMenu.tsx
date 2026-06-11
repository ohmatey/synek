import { ListFilter } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
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

// Toolbar dropdown to choose which node kinds show on the canvas. Multi-select:
// each row toggles a kind's visibility and the menu stays open (onSelect is
// prevented). Drives the same hiddenKinds state the canvas already filters on.
export function FilterMenu({
  counts,
  hiddenKinds,
  onToggleKind,
  onResetKinds,
}: {
  counts: Map<string, number>
  hiddenKinds: Set<string>
  onToggleKind: (token: string) => void
  onResetKinds: () => void
}) {
  const present = KIND_META.filter((k) => (counts.get(k.token) ?? 0) > 0)
  if (present.length === 0) return null
  const hiddenCount = hiddenKinds.size

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn('relative size-8', floatChip, hiddenCount > 0 && 'text-amber-600 dark:text-amber-400')}
          title="Filter what shows on the timeline"
          aria-label={`Filter what shows on the timeline${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}`}
        >
          <ListFilter />
          {hiddenCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
              {hiddenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Show on timeline</span>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="cursor-pointer rounded-sm text-xs font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={onResetKinds}
            >
              Show all
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {present.map((k) => (
          <DropdownMenuCheckboxItem
            key={k.token}
            checked={!hiddenKinds.has(k.token)}
            // Multi-select: keep the menu open as the user toggles several kinds.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggleKind(k.token)}
          >
            <span className="flex flex-1 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: k.color }} aria-hidden />
              <span className="flex-1">{k.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground">{counts.get(k.token) ?? 0}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {hiddenCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onResetKinds}>Show all kinds</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
