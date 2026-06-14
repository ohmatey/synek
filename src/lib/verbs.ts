import { MessagesSquare, Network, Sparkles, PenLine, CalendarClock, type LucideIcon } from 'lucide-react'
import { type PromptSpec } from '~/components/PromptDialog'
import { buildTalkToPrompt } from '~/lib/talk-to-prompt'
import { buildImproveTimelinePrompt, buildThemePrompt } from '~/lib/timeline-prompt'
import { buildStoryPrompt } from '~/lib/story-prompt'
import {
  buildExpandPrompt,
  buildImproveNodePrompt,
  buildWhatsHappeningPrompt,
  buildFillGapPrompt,
  buildExtendLanePrompt,
  buildPopulateEraPrompt,
  buildGlobeBackfillPrompt,
} from '~/lib/node-verb-prompts'
import { formatInstant } from '~/lib/domain/dates'
import type { DeadZone } from '~/lib/domain/dead-zones'
import type { GraphNode } from '~/lib/domain/types'

// The verb registry — the moves a user can run against the canvas (roadmap NEXT.5 ·
// docs/product/prd/next5-verb-system.md). Every verb is the same primitive:
// object (a node) + intent → PromptSpec → MCP tool. Synek mutates nothing itself;
// each verb hands the user's Claude a ready-made prompt (the inversion). One
// registry feeds every surface — the node panel's NodeVerbBar and the ⌘K palette —
// so a verb looks and behaves identically wherever it appears, and adding one is a
// single descriptor (a `showWhen` gate + a `makeSpec`).

export type VerbFamily = 'interact' | 'expand'

export type VerbContext = {
  timelineId: string
  // Rendered as a param row when present; the node panel omits it.
  timelineTitle?: string
  // Where the verb was invoked, tagged onto the copy event so copy-rates read per
  // surface (bet B5 — let signal prioritize the rest of the catalogue).
  // e.g. 'command_palette' | 'node_panel'.
  surface?: string
}

// A verb descriptor: what it's called, when it applies, and how to build its prompt.
export type Verb = {
  id: string
  family: VerbFamily
  icon: LucideIcon
  // Synonyms for ⌘K matching ("expand", "grow", "connect", "story"…).
  keywords: string[]
  label: (node: GraphNode) => string
  // The gate — does this verb apply to this node? This IS the anti-clutter
  // mechanism: a surface filters the registry by `showWhen`, never showing a verb
  // the node can't use.
  showWhen: (node: GraphNode) => boolean
  makeSpec: (node: GraphNode, ctx: VerbContext) => PromptSpec
}

// One copy event for every verb, keyed by verb_id + surface, so bet B5's
// "copy-rates self-prioritize the catalogue" is a single PostHog query.
function verbAnalytics(verbId: string, node: GraphNode, ctx: VerbContext): PromptSpec['analytics'] {
  const props: Record<string, unknown> = {
    verb_id: verbId,
    timeline_id: ctx.timelineId,
    node_kind: node.subtype ?? node.type,
  }
  if (ctx.surface) props.surface = ctx.surface
  return { event: 'verb_prompt_copied', props }
}

// INTERACT — first-person roleplay of an entity; no graph change. The front door
// to multi-POV (roadmap S3.4); verb #1.
export function talkToSpec(node: GraphNode, ctx: VerbContext): PromptSpec {
  const kind = node.subtype ?? 'entity'
  const params = [{ label: 'Speaker', value: `${node.title} (${kind})` }]
  if (ctx.timelineTitle) params.push({ label: 'Timeline', value: ctx.timelineTitle })
  return {
    title: `Talk to ${node.title}`,
    description: `Get ${node.title}'s first-person perspective written onto the moment they're most part of — as a grounded story on the canvas.`,
    params,
    timelineId: ctx.timelineId,
    prompt: buildTalkToPrompt({ timelineId: ctx.timelineId, nodeId: node.id, name: node.title, kind }),
    contextLabel: `Ask ${node.title} something, or set a focus (optional)`,
    contextPlaceholder: `e.g. their exile, a rivalry, founding a school — or a question for them`,
    contextHeading: `What the user wants ${node.title} to address or focus on:`,
    analytics: verbAnalytics('talk-to', node, ctx),
  }
}

// EXPAND — pull in directly-connected entities not yet on the canvas and wire them.
export function expandSpec(node: GraphNode, ctx: VerbContext): PromptSpec {
  return {
    title: `Expand around ${node.title}`,
    description: `Pull in the people, events, and ideas directly connected to ${node.title} that aren't on the timeline yet — and wire the relationships.`,
    params: [{ label: 'Around', value: node.title }],
    timelineId: ctx.timelineId,
    prompt: buildExpandPrompt({ timelineId: ctx.timelineId, nodeId: node.id, title: node.title }),
    contextLabel: 'Narrow the expansion? (optional)',
    contextPlaceholder: 'e.g. only their students, only events after 50 CE, focus on rivals',
    contextHeading: 'Constrain the expansion to what the user asked for:',
    analytics: verbAnalytics('expand', node, ctx),
  }
}

// IMPROVE — tighten a single node (summary, dates, image, citations).
export function improveNodeSpec(node: GraphNode, ctx: VerbContext): PromptSpec {
  const kind = node.subtype ?? node.type
  return {
    title: `Improve this ${kind}`,
    description: `Ask your connected Claude to sharpen ${node.title} — summary, dates, a sourced image, and citations for its claims.`,
    params: [{ label: kind === node.type ? 'Node' : 'Entity', value: node.title }],
    timelineId: ctx.timelineId,
    prompt: buildImproveNodePrompt({ timelineId: ctx.timelineId, nodeId: node.id, title: node.title, kind }),
    contextLabel: 'Anything specific to fix? (optional)',
    contextPlaceholder: 'e.g. the date looks wrong, add a portrait, cite the founding claim',
    contextHeading: 'Focus the improvements on what the user asked for:',
    analytics: verbAnalytics('improve-node', node, ctx),
  }
}

// NARRATE — turn a moment into a short, grounded story.
export function writeStorySpec(node: GraphNode, ctx: VerbContext): PromptSpec {
  return {
    title: `Write a story here`,
    description: `Turn ${node.title} into a short, source-grounded story told beat-by-beat on the canvas.`,
    params: [{ label: 'Moment', value: node.title }],
    timelineId: ctx.timelineId,
    prompt: buildStoryPrompt({ nodeId: node.id, timelineId: ctx.timelineId, title: node.title }),
    contextLabel: 'An angle, or entities to feature? (optional)',
    contextPlaceholder: 'e.g. tell it from the exile years; feature Seneca and Nero',
    contextHeading: 'Shape the story around what the user asked for:',
    analytics: verbAnalytics('write-story', node, ctx),
  }
}

// CONTEXTUALIZE — add the concurrent context as a parallel lane.
export function whatsHappeningSpec(node: GraphNode, ctx: VerbContext): PromptSpec {
  const date = formatInstant(node.startInstant, node.precision)
  return {
    title: `What else was happening?`,
    description: `Add what else was happening around ${date} as a parallel "meanwhile" track beside ${node.title}.`,
    params: [{ label: 'Around', value: date }],
    timelineId: ctx.timelineId,
    prompt: buildWhatsHappeningPrompt({ timelineId: ctx.timelineId, nodeId: node.id, title: node.title, date }),
    contextLabel: 'A region or field to focus? (optional)',
    contextPlaceholder: 'e.g. only Rome, only philosophy, only what Greece was doing',
    contextHeading: 'Scope the concurrent context to what the user asked for:',
    analytics: verbAnalytics('whats-happening', node, ctx),
  }
}

// The node-scoped verbs, in panel/ⓘ display order. Tier 1 of the catalogue.
export const NODE_VERBS: Verb[] = [
  {
    id: 'talk-to',
    family: 'interact',
    icon: MessagesSquare,
    keywords: ['talk', 'voice', 'speak', 'perspective', 'interview', 'roleplay', 'pov'],
    label: (n) => `Talk to ${n.title}`,
    showWhen: (n) => n.type === 'entity',
    makeSpec: talkToSpec,
  },
  {
    id: 'expand',
    family: 'expand',
    icon: Network,
    keywords: ['expand', 'grow', 'branch', 'connect', 'related', 'around', 'more'],
    label: () => 'Expand around this',
    showWhen: () => true,
    makeSpec: expandSpec,
  },
  {
    id: 'improve-node',
    family: 'expand',
    icon: Sparkles,
    keywords: ['improve', 'deepen', 'sharpen', 'fix', 'enrich', 'sources', 'cite'],
    label: (n) => `Improve this ${n.subtype ?? n.type}`,
    showWhen: () => true,
    makeSpec: improveNodeSpec,
  },
  {
    id: 'write-story',
    family: 'expand',
    icon: PenLine,
    keywords: ['story', 'narrate', 'write', 'tell', 'beats'],
    label: () => 'Write a story here',
    showWhen: () => true,
    makeSpec: writeStorySpec,
  },
  {
    id: 'whats-happening',
    family: 'expand',
    icon: CalendarClock,
    keywords: ['meanwhile', 'concurrent', 'context', 'happening', 'parallel', 'era', 'around'],
    label: () => 'What else was happening?',
    showWhen: (n) => n.type === 'event' || n.type === 'period',
    makeSpec: whatsHappeningSpec,
  },
]

// The verbs that apply to a given node, in registry order.
export function verbsForNode(node: GraphNode): Verb[] {
  return NODE_VERBS.filter((v) => v.showWhen(node))
}

// EXPAND verb at the timeline level — review the whole graph and fill it out.
// Lives in ⌘K (not the node panel), so it's separate from NODE_VERBS.
export function improveTimelineSpec(ctx: VerbContext): PromptSpec {
  const props: Record<string, unknown> = { verb_id: 'improve-timeline', timeline_id: ctx.timelineId }
  if (ctx.surface) props.surface = ctx.surface
  return {
    title: 'Improve this timeline',
    description:
      'Ask your connected Claude to review the current graph and fill it out — gaps, missing moments, edges, and citations.',
    params: ctx.timelineTitle ? [{ label: 'Timeline', value: ctx.timelineTitle }] : undefined,
    timelineId: ctx.timelineId,
    prompt: buildImproveTimelinePrompt({ timelineId: ctx.timelineId, title: ctx.timelineTitle ?? '' }),
    contextLabel: 'Anything specific to focus on? (optional)',
    contextPlaceholder: 'e.g. add the Roman Stoics, focus on 200–100 BCE, fix the gaps after Seneca',
    contextHeading: 'Focus the improvements on what the user asked for:',
    analytics: { event: 'verb_prompt_copied', props },
  }
}

// THEME verb at the timeline level — have the connected Claude design the
// timeline's visual identity via set_timeline_theme. Lives in the view-settings
// popover's Theme section (and any future surface), separate from NODE_VERBS.
export function themeTimelineSpec(ctx: VerbContext): PromptSpec {
  const props: Record<string, unknown> = { verb_id: 'theme-timeline', timeline_id: ctx.timelineId }
  if (ctx.surface) props.surface = ctx.surface
  return {
    title: 'Theme this timeline',
    description:
      'Ask your connected Claude to design this timeline\'s visual identity — era-appropriate accent colors, a canvas wash, a display font, and the image style it reuses for future art.',
    params: ctx.timelineTitle ? [{ label: 'Timeline', value: ctx.timelineTitle }] : undefined,
    timelineId: ctx.timelineId,
    prompt: buildThemePrompt({ timelineId: ctx.timelineId, title: ctx.timelineTitle ?? '' }),
    contextLabel: 'Describe the mood you want (optional)',
    contextPlaceholder: 'e.g. weathered parchment and bronze; neon noir; Bauhaus poster',
    contextHeading: 'Shape the theme around what the user asked for:',
    analytics: { event: 'verb_prompt_copied', props },
  }
}

// GLOBE BACKFILL — ask the connected Claude to add lat/lng to the timeline's
// place-bearing nodes so the globe lens can plot them. Timeline-level; surfaced in
// ⌘K ("Set up globe view") and the globe's coverage banner. Fires the globe-specific
// `globe_backfill_prompt_copied` event (the PRD's named metric), not verb_prompt_copied.
export function globeBackfillSpec(ctx: VerbContext, uncoordinatedCount?: number): PromptSpec {
  const props: Record<string, unknown> = { timeline_id: ctx.timelineId }
  if (ctx.surface) props.surface = ctx.surface
  if (uncoordinatedCount != null) props.uncoordinated_count = uncoordinatedCount
  return {
    title: 'Set up the globe view',
    description:
      'Ask your connected Claude to give every node a globe verdict — map coordinates (lat/lng) where it happened, or a "no single place" marker — so the globe is complete and honest.',
    params: ctx.timelineTitle ? [{ label: 'Timeline', value: ctx.timelineTitle }] : undefined,
    timelineId: ctx.timelineId,
    prompt: buildGlobeBackfillPrompt({ timelineId: ctx.timelineId, title: ctx.timelineTitle ?? '' }),
    contextLabel: 'Anything specific about places? (optional)',
    contextPlaceholder: 'e.g. use birthplaces for the philosophers, launch sites for the missions',
    contextHeading: 'Focus the coordinates on what the user asked for:',
    analytics: { event: 'globe_backfill_prompt_copied', props },
  }
}

// FILL GAP — populate an empty stretch of the axis (a "dead zone"). Gap-scoped, not
// node-scoped, so it sits beside NODE_VERBS; surfaced by the canvas gap ghosts
// (NEXT.5 Tier 2 — docs/product/prd/next5-tier2-alive-canvas.md).
export function fillGapSpec(zone: DeadZone, ctx: VerbContext): PromptSpec {
  const from = formatInstant(zone.fromInstant, 'year')
  const to = formatInstant(zone.toInstant, 'year')
  const props: Record<string, unknown> = {
    verb_id: 'fill-gap',
    timeline_id: ctx.timelineId,
    years: zone.years,
  }
  if (ctx.surface) props.surface = ctx.surface
  return {
    title: `Fill ${from} → ${to}`,
    description: `Add the significant people, events, and works between ${from} and ${to} — a ${zone.years}-year empty stretch on this timeline.`,
    params: [
      { label: 'Span', value: `${from} → ${to}` },
      { label: 'Empty', value: `≈${zone.years} years` },
    ],
    timelineId: ctx.timelineId,
    prompt: buildFillGapPrompt({ timelineId: ctx.timelineId, fromDate: from, toDate: to, years: zone.years }),
    contextLabel: 'Focus the fill? (optional)',
    contextPlaceholder: 'e.g. only Roman Stoics, only key texts, only political events',
    contextHeading: 'Focus what gets added to the gap:',
    analytics: { event: 'verb_prompt_copied', props },
  }
}

// EXTEND LANE — add to a thin swimlane ("rival track"). Lane-scoped; surfaced by a
// canvas lane invitation (NEXT.5 Tier 2).
export function extendLaneSpec(lane: string, ctx: VerbContext): PromptSpec {
  const props: Record<string, unknown> = { verb_id: 'extend-lane', timeline_id: ctx.timelineId }
  if (ctx.surface) props.surface = ctx.surface
  return {
    title: `Add to ${lane}`,
    description: `This "${lane}" track is thin — pull in the people, events, and works that belong on it.`,
    params: [{ label: 'Track', value: lane }],
    timelineId: ctx.timelineId,
    prompt: buildExtendLanePrompt({ timelineId: ctx.timelineId, lane }),
    contextLabel: 'Focus the additions? (optional)',
    contextPlaceholder: 'e.g. only the founders, only after the merger',
    contextHeading: 'Focus what gets added to the track:',
    analytics: { event: 'verb_prompt_copied', props },
  }
}

// POPULATE ERA — fill out a bare period. Era-scoped; surfaced by a canvas era
// invitation (NEXT.5 Tier 2).
export function populateEraSpec(
  era: { title: string; fromInstant: number; toInstant: number },
  ctx: VerbContext,
): PromptSpec {
  const from = formatInstant(era.fromInstant, 'year')
  const to = formatInstant(era.toInstant, 'year')
  const props: Record<string, unknown> = { verb_id: 'populate-era', timeline_id: ctx.timelineId }
  if (ctx.surface) props.surface = ctx.surface
  return {
    title: `Populate ${era.title}`,
    description: `The "${era.title}" era (${from}–${to}) is nearly empty — add the moments that belong in it.`,
    params: [
      { label: 'Era', value: era.title },
      { label: 'Span', value: `${from} → ${to}` },
    ],
    timelineId: ctx.timelineId,
    prompt: buildPopulateEraPrompt({ timelineId: ctx.timelineId, era: era.title, fromDate: from, toDate: to }),
    contextLabel: 'Focus the era? (optional)',
    contextPlaceholder: 'e.g. only key texts, only political events, only this region',
    contextHeading: 'Focus what gets added to the era:',
    analytics: { event: 'verb_prompt_copied', props },
  }
}
