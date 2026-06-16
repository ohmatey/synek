import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, Palette, Search, Shirt, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { PromptActions } from '~/components/PromptActions'
import { DepthControl, GenreControl } from '~/components/PromptKnobs'
import { ThemeEditorDialog } from '~/components/canvas/ThemeEditorDialog'
import { BrandManagerDialog } from '~/components/brand/BrandManagerDialog'
import { buildStoryPrompt } from '~/lib/story-prompt'
import { composeStoryKnobs, genrePreset, type Depth, type Genre } from '~/lib/prompt-knobs'
import { getTimelineBrandInfo } from '~/lib/server/brands'
import { capture } from '~/lib/posthog/client'
import { cn } from '~/lib/utils'
import type { TimelineTheme } from '~/lib/domain/types'

// "New Story" surface for the AppBar Stories menu. The app holds no AI, so it can't
// write a story itself — instead it helps the user assemble a prompt to paste into
// their connected Claude, which calls write_story. Pick the entities the story is
// about, choose which one is the anchor (the moment it's written onto; the rest are
// woven in as a guided-tour cast), optionally give it an angle, then copy the prompt.
// Controlled by the menu (rendered as a sibling of the popover so opening it closes
// the popover cleanly).
type PickNode = { id: string; title: string; type: string }

export function NewStoryDialog({
  open,
  onOpenChange,
  timelineId,
  nodes,
  initialAnchorId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  timelineId: string
  nodes: PickNode[]
  // When opened from a specific entity (the detail panel), pre-select + anchor it.
  initialAnchorId?: string
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // The entity the story is written onto. The user picks it explicitly; until they
  // do (or if they remove it) it falls back to the first selected entity.
  const [anchorChoice, setAnchorChoice] = useState<string | null>(null)
  const [angle, setAngle] = useState('')
  // The Storyteller's console knobs: a genre (voice + a suggested theme), the depth
  // of the writing pass, whether to dress it in the project's brand voice, and the
  // story's own theme (seeded from the genre, tunable) — which rides into the prompt
  // via write_story's `theme` field so a story carries its own look.
  const [genre, setGenre] = useState<Genre | null>(null)
  const [depth, setDepth] = useState<Depth>('standard')
  const [brandOn, setBrandOn] = useState(false)
  const [storyTheme, setStoryTheme] = useState<TimelineTheme | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const [brandManagerOpen, setBrandManagerOpen] = useState(false)

  // The brand the story's project is dressed by (for the "brand costume" row).
  const brand = useQuery({
    queryKey: ['timeline-brand', timelineId],
    queryFn: () => getTimelineBrandInfo({ data: timelineId }),
    enabled: open,
  })

  // Seed (or clear) the picker each time the dialog opens, anchored to the entity it
  // was opened from when there is one. Keyed on `open` so a reopen starts fresh.
  useEffect(() => {
    if (!open) return
    setSelectedIds(initialAnchorId ? [initialAnchorId] : [])
    setAnchorChoice(initialAnchorId ?? null)
    setQuery('')
    setAngle('')
    setGenre(null)
    setDepth('standard')
    setBrandOn(false)
    setStoryTheme(null)
  }, [open, initialAnchorId])

  // Picking a genre seeds its suggested theme (so "genre suggests a theme"); clearing
  // it clears the seeded theme. The user can then fine-tune via the theme editor.
  const onGenreChange = (next: Genre | null) => {
    setGenre(next)
    setStoryTheme(next ? (genrePreset(next)?.theme ?? null) : null)
  }

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? nodes.filter((n) => n.title.toLowerCase().includes(q)) : nodes
    return list.slice(0, 50)
  }, [nodes, query])

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Roving-tabindex keyboard nav for the anchor radiogroup: the group is a single tab
  // stop and arrows move (and select) between radios, per the WAI-ARIA radio pattern.
  const radioRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const onRadioKeyDown = (e: React.KeyboardEvent, index: number) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const last = selectedIds.length - 1
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? last
          : e.key === 'ArrowDown' || e.key === 'ArrowRight'
            ? index === last
              ? 0
              : index + 1
            : index === 0
              ? last
              : index - 1
    const nextId = selectedIds[next]
    if (!nextId) return
    setAnchorChoice(nextId)
    radioRefs.current.get(nextId)?.focus()
  }

  // Effective anchor: the explicit choice if it's still selected, else the first
  // selected entity (no effects needed — derive it each render).
  const anchorId = anchorChoice && selectedIds.includes(anchorChoice) ? anchorChoice : (selectedIds[0] ?? null)
  const anchor = anchorId ? byId.get(anchorId) ?? null : null
  const featured = selectedIds
    .filter((id) => id !== anchorId)
    .flatMap((id) => {
      const n = byId.get(id)
      return n ? [{ id: n.id, title: n.title }] : []
    })
  const brandVoice = brandOn ? (brand.data?.voice ?? null) : null
  const prompt = anchor
    ? composeStoryKnobs(
        buildStoryPrompt({ nodeId: anchor.id, timelineId, title: anchor.title, angle, featured }),
        { depth, genre, brandVoice, storyTheme },
      )
    : ''

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Story</DialogTitle>
          <DialogDescription>
            Pick the entities this story is about, then copy a prompt to paste into your connected Claude — it writes
            the story back onto the canvas.
          </DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Entities</span>
            <span className="text-xs text-muted-foreground">
              {selectedIds.length === 0
                ? 'Pick one or more'
                : `${selectedIds.length} selected${featured.length ? ` · ${featured.length} featured` : ''}`}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entities…"
              aria-label="Search entities"
              autoComplete="off"
              spellCheck={false}
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
          <div className="flex max-h-44 flex-col gap-1 overflow-auto rounded-md border border-border p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matching entities.</p>
            ) : (
              filtered.map((n) => {
                const isSelected = selectedIds.includes(n.id)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => toggle(n.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {isSelected && <Check aria-hidden="true" className="size-3" />}
                    </span>
                    <span className="flex-1 truncate">{n.title}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{n.type}</span>
                  </button>
                )
              })
            )}
          </div>

          {/* Selected entities — choose the anchor (radio) the story is written onto;
              the rest are featured. */}
          {selectedIds.length > 0 && (
            <div role="radiogroup" aria-label="Anchor moment" className="flex flex-col gap-1 rounded-md border border-border p-2">
              <span className="text-xs text-muted-foreground">Anchor moment — the story is written onto this one</span>
              {selectedIds.map((id, index) => {
                const n = byId.get(id)
                if (!n) return null
                const isAnchor = id === anchorId
                return (
                  <div key={id} className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) radioRefs.current.set(id, el)
                        else radioRefs.current.delete(id)
                      }}
                      onClick={() => setAnchorChoice(id)}
                      onKeyDown={(e) => onRadioKeyDown(e, index)}
                      role="radio"
                      aria-checked={isAnchor}
                      aria-label={`Set ${n.title} as the anchor moment`}
                      tabIndex={isAnchor ? 0 : -1}
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        isAnchor ? 'border-primary' : 'border-border hover:border-primary/60',
                      )}
                    >
                      {isAnchor && <span className="size-2 rounded-full bg-primary" />}
                    </button>
                    <span className={cn('flex-1 truncate', isAnchor ? 'font-medium' : 'text-muted-foreground')}>
                      {n.title}
                    </span>
                    {!isAnchor && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Featured
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      aria-label={`Remove ${n.title}`}
                      className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="new-story-angle" className="text-sm font-medium">
            Angle <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="new-story-angle"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="e.g. tell it from a witness’s point of view, or focus on the rivalry"
            rows={2}
          />
        </section>

        {/* The Storyteller's console: genre (voice + a suggested theme), the story's
            own theme, a brand costume, and how deep to write. */}
        <GenreControl value={genre} onChange={onGenreChange} />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              Story theme <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <div className="flex items-center gap-1.5">
              {storyTheme && (
                <button
                  type="button"
                  onClick={() => {
                    setStoryTheme(null)
                    setGenre(null)
                  }}
                  className="cursor-pointer rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setThemeOpen(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <Palette aria-hidden="true" className="size-3.5" />
                {storyTheme ? 'Customize' : 'Set a theme'}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {storyTheme
              ? `“${storyTheme.name ?? 'Custom'}” — its own look on the shared story page, independent of the timeline.`
              : 'Pick a genre to suggest one, or set your own. Independent of the timeline’s theme.'}
          </p>
        </section>

        {/* Brand costume — dress the story in the project's brand voice, or set one up. */}
        {brand.data?.voice ? (
          <button
            type="button"
            onClick={() => setBrandOn((v) => !v)}
            aria-pressed={brandOn}
            className={cn(
              'flex items-center gap-2.5 rounded-md border p-2.5 text-left transition-colors',
              brandOn ? 'border-primary bg-accent/40' : 'border-border hover:bg-accent/30',
            )}
          >
            <Shirt aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block text-sm font-medium">Brand costume</span>
              <span className="block text-xs text-muted-foreground">
                Write in {brand.data.brandName}’s voice
              </span>
            </span>
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border',
                brandOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {brandOn && <Check aria-hidden="true" className="size-3" />}
            </span>
          </button>
        ) : brand.data?.projectId ? (
          <button
            type="button"
            onClick={() => setBrandManagerOpen(true)}
            className="flex items-center gap-2.5 rounded-md border border-dashed border-border p-2.5 text-left hover:bg-accent/30"
          >
            <Shirt aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block text-sm font-medium">Brand costume</span>
              <span className="block text-xs text-muted-foreground">
                Set up a brand voice for this project
              </span>
            </span>
          </button>
        ) : null}

        <DepthControl value={depth} onChange={setDepth} />

        <PromptActions
          prompt={prompt}
          timelineId={timelineId}
          resetKey={open}
          copyLabel={anchor ? `Copy prompt for “${anchor.title}”` : 'Pick an entity first'}
          copiedLabel="Prompt copied — paste into Claude"
          disabled={!anchor}
          onCopy={() =>
            capture('story_prompt_copied', {
              timeline_id: timelineId,
              mode: 'new',
              genre: genre ?? undefined,
              depth,
              brand: brandOn,
              themed: Boolean(storyTheme),
            })
          }
          runAnalyticsProps={{
            timeline_id: timelineId,
            mode: 'new',
            verb_id: 'write-story',
            genre: genre ?? undefined,
            depth,
            brand: brandOn,
          }}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookOpen aria-hidden="true" className="size-3.5" />
          The story appears on the canvas as soon as it’s written — no refresh needed.
        </p>
      </DialogContent>
    </Dialog>

      {/* Tune the story's own theme. Pre-creation, so there's no story row yet — the
          editor stashes the theme in local state and it rides into the write_story
          prompt. No live canvas preview (the timeline behind isn't this story). */}
      <ThemeEditorDialog
        open={themeOpen}
        onOpenChange={setThemeOpen}
        theme={storyTheme}
        title="Story theme"
        description="A look for this story alone — it renders on the shared story page, independent of the timeline's theme."
        onSave={async (t) => setStoryTheme(t)}
      />

      {/* Set up / link a brand to this project, then re-read so the costume row updates. */}
      {brand.data?.projectId && (
        <BrandManagerDialog
          open={brandManagerOpen}
          onOpenChange={(o) => {
            setBrandManagerOpen(o)
            if (!o) void qc.invalidateQueries({ queryKey: ['timeline-brand', timelineId] })
          }}
          linkProject={{ id: brand.data.projectId, title: brand.data.projectTitle ?? 'this project' }}
        />
      )}
    </>
  )
}
