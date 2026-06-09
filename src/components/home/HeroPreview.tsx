import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'
import { LiveTimeline, PREVIEWS, type PreviewKey } from './LiveTimeline'

// The hero's framed "app window" — a switchable, self-building timeline preview.
// Switching remounts LiveTimeline (via key) so the build animation replays.
export function HeroPreview() {
  const [active, setActive] = useState<PreviewKey>('cloud')

  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl">
      <div className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[2rem] bg-primary/10 blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <span className="hidden gap-1.5 sm:flex">
            <span className="size-3 rounded-full bg-destructive/70" />
            <span className="size-3 rounded-full bg-warning/70" />
            <span className="size-3 rounded-full bg-success/70" />
          </span>

          {/* Preview switcher — segmented control over the three sample timelines. */}
          <div
            role="tablist"
            aria-label="Preview a timeline"
            className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border/60 bg-background/50 p-0.5"
          >
            {PREVIEWS.map((p) => {
              const selected = p.key === active
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(p.key)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    selected
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <Badge variant="soft" className="ml-auto hidden gap-1.5 sm:inline-flex">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            building…
          </Badge>
        </div>
        <div className="bg-gradient-to-b from-transparent to-background/40 p-4 sm:p-6">
          <LiveTimeline key={active} preview={active} />
        </div>
      </div>
    </div>
  )
}
