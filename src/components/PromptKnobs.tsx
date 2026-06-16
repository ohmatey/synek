import { cn } from '~/lib/utils'
import { DEPTHS, DEPTH_META, GENRE_PRESETS, type Depth, type Genre } from '~/lib/prompt-knobs'

// The "Storyteller's console" knob controls — small, expressive segmented controls
// shared by the prompt dialogs. They never call the agent; they just shape the
// prompt the user copies or runs. Plain accessible buttons (roving radiogroup),
// styled with the app's semantic tokens so they sit native in the dialogs.

// Depth — how much a prompt should add (quick / standard / deep). Applies to every
// prompt (build, expand, fill, write a story, …) via an appended scope directive.
export function DepthControl({
  value,
  onChange,
  label = 'Depth',
}: {
  value: Depth
  onChange: (depth: Depth) => void
  label?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-md border border-border bg-muted/40 p-1"
      >
        {DEPTHS.map((d) => {
          const active = d === value
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={active}
              title={DEPTH_META[d].hint}
              onClick={() => onChange(d)}
              className={cn(
                'flex-1 cursor-pointer rounded-sm px-2 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {DEPTH_META[d].label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{DEPTH_META[value].hint}</p>
    </div>
  )
}

// Genre wheel — a story's voice. Picking one injects a voice directive AND surfaces
// its suggested theme (the parent decides whether to apply/embed it). Clicking the
// active genre again clears it (back to a plain, neutral voice).
export function GenreControl({
  value,
  onChange,
}: {
  value: Genre | null
  onChange: (genre: Genre | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        Genre <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      <div role="radiogroup" aria-label="Story genre" className="flex flex-wrap gap-1.5">
        {GENRE_PRESETS.map((g) => {
          const active = g.id === value
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={g.blurb}
              onClick={() => onChange(active ? null : g.id)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}
            >
              {g.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
