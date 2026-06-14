import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Search, X } from 'lucide-react'
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
import { buildStoryPrompt } from '~/lib/story-prompt'
import { capture } from '~/lib/posthog/client'
import { cn } from '~/lib/utils'

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
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // The entity the story is written onto. The user picks it explicitly; until they
  // do (or if they remove it) it falls back to the first selected entity.
  const [anchorChoice, setAnchorChoice] = useState<string | null>(null)
  const [angle, setAngle] = useState('')

  // Seed (or clear) the picker each time the dialog opens, anchored to the entity it
  // was opened from when there is one. Keyed on `open` so a reopen starts fresh.
  useEffect(() => {
    if (!open) return
    setSelectedIds(initialAnchorId ? [initialAnchorId] : [])
    setAnchorChoice(initialAnchorId ?? null)
    setQuery('')
    setAngle('')
  }, [open, initialAnchorId])

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
  const prompt = anchor
    ? buildStoryPrompt({ nodeId: anchor.id, timelineId, title: anchor.title, angle, featured })
    : ''

  return (
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

        <PromptActions
          prompt={prompt}
          timelineId={timelineId}
          resetKey={open}
          copyLabel={anchor ? `Copy prompt for “${anchor.title}”` : 'Pick an entity first'}
          copiedLabel="Prompt copied — paste into Claude"
          disabled={!anchor}
          onCopy={() => capture('story_prompt_copied', { timeline_id: timelineId, mode: 'new' })}
          runAnalyticsProps={{ timeline_id: timelineId, mode: 'new', verb_id: 'write-story' }}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookOpen aria-hidden="true" className="size-3.5" />
          The story appears on the canvas as soon as it’s written — no refresh needed.
        </p>
      </DialogContent>
    </Dialog>
  )
}
