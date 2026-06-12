import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Box,
  Building2,
  Layers,
  Lightbulb,
  ListFilter,
  MapPin,
  MessagesSquare,
  Palette,
  Search,
  Sparkles,
  User,
  Zap,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { PromptDialog, type PromptSpec } from '~/components/PromptDialog'
import { capture } from '~/lib/posthog/client'
import { cn } from '~/lib/utils'
import { formatInstant } from '~/lib/domain/dates'
import { talkToSpec, improveTimelineSpec, themeTimelineSpec, verbsForNode } from '~/lib/verbs'
import type { GraphNode, NodeType } from '~/lib/domain/types'
import { floatChip } from './chrome'

// Groups read top-to-bottom in the same order as the canvas lanes, so the
// palette mirrors the timeline's vertical structure.
const GROUP_ORDER: { type: NodeType; label: string }[] = [
  { type: 'period', label: 'Periods' },
  { type: 'entity', label: 'Entities' },
  { type: 'concept', label: 'Concepts' },
  { type: 'event', label: 'Events' },
]

// Icon per node — entities branch by subtype (person/org/place/work) so a
// search result is recognizable at a glance; everything else is keyed by type.
function nodeIcon(n: GraphNode) {
  if (n.type === 'period') return Layers
  if (n.type === 'concept') return Lightbulb
  if (n.type === 'event') return Zap
  switch (n.subtype) {
    case 'person':
      return User
    case 'org':
      return Building2
    case 'place':
      return MapPin
    case 'work':
      return BookOpen
    default:
      return Box
  }
}

// ⌘K palette over the already-loaded graph (no fetch). Two kinds of results:
// NAVIGATION (jump to a node — pans/centers + opens its panel via onSelect) and
// ACTIONS (open a PromptDialog the user copies into their Claude to work on the
// timeline). Actions are an extensible list; today: "Improve this timeline" and
// per-entity "Talk to …".
export function CommandPalette({
  nodes,
  onSelect,
  timelineId,
  timelineTitle,
  selectedNode,
}: {
  nodes: GraphNode[]
  onSelect: (id: string) => void
  timelineId: string
  timelineTitle: string
  // The node currently open in the detail panel, if any — its verbs lead the list.
  selectedNode?: GraphNode | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // The prompt currently shown in the shared PromptDialog (null = closed).
  const [promptSpec, setPromptSpec] = useState<PromptSpec | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set when a close is caused by opening the PromptDialog, so the close handler
  // doesn't yank focus back to the trigger and fight the prompt's focus trap.
  const openingPromptRef = useRef(false)
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (promptTimer.current) clearTimeout(promptTimer.current) }, [])

  // On every close: reset the query, and restore focus to the trigger — except
  // when we're closing in order to open the PromptDialog. Radix returns focus to
  // whatever was focused at open time, but a ⌘K (keyboard) open often leaves
  // <body> focused, so without this, focus is lost.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) {
      setQuery('')
      if (openingPromptRef.current) openingPromptRef.current = false
      else requestAnimationFrame(() => triggerRef.current?.focus())
    }
    wasOpen.current = open
  }, [open])

  // ⌘K / Ctrl-K toggles the palette — mirrors HistoryControls' window-keydown
  // idiom. No input guard on purpose: ⌘K is modifier-invoked, so (unlike a bare
  // single-key shortcut) it's always a deliberate reach for search, even from a
  // text field — the convention every command palette follows.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Engagement signal: the palette was opened (keyboard or click).
  useEffect(() => {
    if (open) capture('command_palette_used')
  }, [open])

  // Chronological within each lane group; cmdk re-ranks by match score while a
  // query is typed, so this order only governs the unfiltered list.
  const groups = useMemo(() => {
    const byType = new Map<NodeType, GraphNode[]>()
    for (const n of nodes) {
      const arr = byType.get(n.type)
      if (arr) arr.push(n)
      else byType.set(n.type, [n])
    }
    for (const arr of byType.values()) arr.sort((a, b) => a.startInstant - b.startInstant)
    return GROUP_ORDER.map((g) => ({ ...g, items: byType.get(g.type) ?? [] })).filter(
      (g) => g.items.length > 0,
    )
  }, [nodes])

  const entityNodes = useMemo(() => nodes.filter((n) => n.type === 'entity'), [nodes])

  // Verbs for the currently-selected node lead the list, so opening ⌘K with a node
  // selected puts its actions at the very top, typeable by name. The per-entity
  // Talk-to list (discovery without a selection) drops the selected node so its
  // Talk-to isn't shown twice.
  const selectedVerbs = useMemo(() => (selectedNode ? verbsForNode(selectedNode) : []), [selectedNode])
  const talkToEntities = useMemo(
    () => entityNodes.filter((n) => n.id !== selectedNode?.id),
    [entityNodes, selectedNode],
  )

  // Per-palette result filter: which categories show in the list. Separate from
  // the canvas kind-filter — this only narrows the palette, not the canvas.
  // 'actions' + each present node group; default all shown.
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  const toggleCat = (key: string) =>
    setHiddenCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const categories = useMemo(
    () => [
      // +2 = the timeline-level actions (Improve, Theme); the rest are per-node.
      { key: 'actions', label: 'Verbs', count: selectedVerbs.length + 2 + talkToEntities.length },
      ...groups.map((g) => ({ key: g.type as string, label: g.label, count: g.items.length })),
    ],
    [groups, selectedVerbs, talkToEntities],
  )

  function navigate(id: string) {
    setOpen(false)
    onSelect(id)
  }

  function runAction(spec: PromptSpec) {
    openingPromptRef.current = true
    setOpen(false)
    // Wait for the palette to finish closing before opening the prompt. Two
    // overlapping modal dialogs make Radix mark the closing one inert mid-exit,
    // so its animationend never fires and it never unmounts — leaving a stuck
    // overlay that blocks the canvas. Sequencing past the 200ms close animation
    // avoids that.
    if (promptTimer.current) clearTimeout(promptTimer.current)
    promptTimer.current = setTimeout(() => setPromptSpec(spec), 260)
  }

  // Verb specs come from the shared registry (src/lib/verbs.ts) so the palette
  // and the node panel produce identical prompts; `surface` tags the copy event.
  const ctx = { timelineId, timelineTitle, surface: 'command_palette' }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Search this timeline"
            onClick={() => setOpen(true)}
            className={cn(
              floatChip,
              'inline-flex h-9 cursor-pointer items-center gap-2 px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
            )}
          >
            <Search className="size-4" />
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
              ⌘K
            </kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent>Search &amp; act · ⌘K</TooltipContent>
      </Tooltip>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search this timeline"
        description="Jump to a node, or run an action like talking to an entity or improving the timeline."
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search nodes, or type an action like “talk to…” or “improve”"
          // Result filter sits in the input row (where the close button used to
          // be), vertically aligned with the search field.
          trailing={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Filter what shows in the results"
                >
                  <ListFilter className="size-4" />
                  {hiddenCats.size > 0 && (
                    <span className="tabular-nums">{categories.length - hiddenCats.size}</span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Show in results</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {categories.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={!hiddenCats.has(c.key)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleCat(c.key)}
                  >
                    <span className="flex flex-1 items-center justify-between gap-2">
                      <span>{c.label}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">{c.count}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {hiddenCats.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setHiddenCats(new Set())}>Show all</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <CommandList>
          <CommandEmpty>No matching nodes or actions.</CommandEmpty>

          {!hiddenCats.has('actions') && (
            <CommandGroup heading="Verbs">
              {/* The selected node's verbs lead — open ⌘K on a node, type "expand"
                  / "talk" / "story", and act on it without leaving the keyboard. */}
              {selectedNode &&
                selectedVerbs.map((v) => {
                  const Icon = v.icon
                  return (
                    <CommandItem
                      key={`verb:${v.id}`}
                      value={`verb:${v.id}:${selectedNode.id}`}
                      keywords={[...v.keywords, selectedNode.title, v.family]}
                      onSelect={() => runAction(v.makeSpec(selectedNode, ctx))}
                    >
                      <Icon className="text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{v.label(selectedNode)}</span>
                      <span className="shrink-0 pl-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {selectedNode.title}
                      </span>
                    </CommandItem>
                  )
                })}
              <CommandItem
                value="action:improve"
                keywords={['improve', 'fill', 'gaps', 'review', 'fix', 'timeline']}
                onSelect={() => runAction(improveTimelineSpec(ctx))}
              >
                <Sparkles className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">Improve this timeline…</span>
              </CommandItem>
              <CommandItem
                value="action:theme"
                keywords={['theme', 'colors', 'palette', 'style', 'font', 'mood', 'look', 'design']}
                onSelect={() => runAction(themeTimelineSpec(ctx))}
              >
                <Palette className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">Theme this timeline…</span>
              </CommandItem>
              {talkToEntities.map((n) => (
                <CommandItem
                  key={`talk:${n.id}`}
                  value={`talk:${n.id}`}
                  keywords={[n.title, 'talk', 'voice', 'perspective', 'interview', n.subtype ?? '']}
                  onSelect={() => runAction(talkToSpec(n, ctx))}
                >
                  <MessagesSquare className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">Talk to {n.title}</span>
                  <span className="shrink-0 pl-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {n.subtype ?? 'entity'}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {groups
            .filter((g) => !hiddenCats.has(g.type))
            .map((g) => (
            <CommandGroup key={g.type} heading={g.label}>
              {g.items.map((n) => {
                const Icon = nodeIcon(n)
                return (
                  <CommandItem
                    key={n.id}
                    // id (unique) is the cmdk value; searchable text rides in
                    // keywords so title + summary + location all match.
                    value={n.id}
                    keywords={[n.title, n.summary ?? '', n.location ?? '', n.type, n.subtype ?? ''].filter(
                      Boolean,
                    )}
                    onSelect={() => navigate(n.id)}
                  >
                    <Icon className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    {n.location ? (
                      <span className="hidden max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground sm:inline">
                        {n.location}
                      </span>
                    ) : null}
                    <span className="shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">
                      {formatInstant(n.startInstant, n.precision)}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>

      <PromptDialog
        open={!!promptSpec}
        onOpenChange={(next) => {
          if (!next) {
            setPromptSpec(null)
            requestAnimationFrame(() => triggerRef.current?.focus())
          }
        }}
        spec={promptSpec}
      />
    </>
  )
}
