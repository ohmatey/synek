import { z } from 'zod'

// Timeline memory — the per-timeline context store that replaces the "Keeper log"
// bookkeeping node (synek-plugin building-timelines, "The keeper log node").
//
// That node was a routine's private state wearing graph clothing: it needed four
// documented exemptions (skip it in watermarks, don't cite it, don't pin it, keep
// it out of story frontiers) because it is not a claim about the world. Exemptions
// that numerous mean the wrong container. Moving the record off the graph dissolves
// all four — it is no longer a node, so there is no watermark to poison, no
// cite-every-node rule to exempt, no coordinate backfill to skip, no story frontier
// to stay out of.
//
// TWO OWNERSHIP REGIONS, one store. The regions have opposite write patterns and
// merging them silently destroys the user's work:
//
//   USER-OWNED    (brief, notes, references) — you author these; a keeper run READS
//                 them for grounding and must never write them.
//   ROUTINE-OWNED (cadence, coveredThrough, runs, watching) — rewritten every run;
//                 readable in-app but not hand-authored.
//
// This is the same hazard the timelines table already documents for
// viewSettings vs theme ("both setters are whole-object replace-writes, so sharing
// a column would have each clobber the other"). Here the answer is one column with
// FIELD-SCOPED writes (timelineMemoryUpdateSchema): an update touches only the keys
// it names, so a keeper logging a run cannot clobber the notes beside it.
//
// Kept apart from types.ts so the zod dependency stays out of the type-only module,
// mirroring domain/theme.ts.

// ISO calendar date, e.g. "2026-08-10". Deliberately strict: the old log stored
// these as freeform prose inside a summary blob, which meant the routine had to
// re-parse its own handwriting every run.
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isoDate = z.string().regex(ISO_DATE_RE, 'must be an ISO calendar date like "2026-08-10"')

// A standing source this timeline is grounded in — a changelog, a release-notes
// page, a beat worth re-checking. NOT a node citation (those live on the node) and
// NOT a bibliographic `sources` row (that table is a citation corpus for beats,
// owner+project scoped with no timeline association). This is the keeper's search
// plan: where to look, restated durably so it survives between runs and the user
// can edit it. A reference that later needs citing from a beat gets promoted into
// `sources` via register_artifact.
export const timelineReferenceSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000).optional(),
  note: z.string().trim().max(500).optional(),
})

// One keeper run. `patchId` is what keeps the log honest under undo: memory lives
// outside the Patch stack (like theme/viewSettings), so ⌘Z on a keeper run would
// otherwise revert the nodes while coveredThrough still claimed them, and the next
// run would skip the window forever. Storing the patch id lets a reader join to
// patches.status and treat a reverted run as reverted, with no new GraphOp kind.
export const timelineRunSchema = z.strictObject({
  date: isoDate,
  routine: z.string().trim().max(80).optional(),
  summary: z.string().trim().min(1).max(300),
  patchId: z.string().trim().max(64).optional(),
})

// Something real but under the scope bar: weighed, deferred, and recorded so a
// later run does not re-litigate it from scratch. `promoteIf` is the specific
// trigger that would turn it into a node.
export const timelineWatchItemSchema = z.strictObject({
  item: z.string().trim().min(1).max(300),
  firstSeen: isoDate,
  rechecked: z.number().int().min(0).max(999).optional(),
  promoteIf: z.string().trim().max(300).optional(),
})

// Bounds. This record is folded into get_layout_report, which a keeper reads at the
// start of every run, so it is capped to stay context-cheap.
export const MEMORY_LIMITS = {
  brief: 2000,
  notes: 8000,
  references: 30,
  runs: 20,
  watching: 15,
} as const

export const timelineMemorySchema = z.strictObject({
  // --- user-owned ---
  brief: z.string().trim().max(MEMORY_LIMITS.brief).optional(),
  notes: z.string().trim().max(MEMORY_LIMITS.notes).optional(),
  references: z.array(timelineReferenceSchema).max(MEMORY_LIMITS.references).optional(),
  // --- routine-owned ---
  cadence: z.string().trim().max(120).optional(),
  coveredThrough: isoDate.optional(),
  runs: z.array(timelineRunSchema).max(MEMORY_LIMITS.runs).optional(),
  watching: z.array(timelineWatchItemSchema).max(MEMORY_LIMITS.watching).optional(),
})

// The write contract. Every key is optional and only the keys PRESENT are written
// (see mergeTimelineMemory) — that field-scoping is what lets the keeper and the
// user share one column. `appendRun` is deliberately not `runs`: a routine appends
// one entry and the store trims, so a model cannot silently drop run history by
// rewriting the array from a stale read.
export const timelineMemoryUpdateSchema = z
  .strictObject({
    brief: z.string().trim().max(MEMORY_LIMITS.brief).optional(),
    notes: z.string().trim().max(MEMORY_LIMITS.notes).optional(),
    references: z.array(timelineReferenceSchema).max(MEMORY_LIMITS.references).optional(),
    cadence: z.string().trim().max(120).optional(),
    coveredThrough: isoDate.optional(),
    watching: z.array(timelineWatchItemSchema).max(MEMORY_LIMITS.watching).optional(),
    appendRun: timelineRunSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'pass at least one field to update' })

export type TimelineReference = z.infer<typeof timelineReferenceSchema>
export type TimelineRun = z.infer<typeof timelineRunSchema>
export type TimelineWatchItem = z.infer<typeof timelineWatchItemSchema>
export type TimelineMemory = z.infer<typeof timelineMemorySchema>
export type TimelineMemoryUpdate = z.infer<typeof timelineMemoryUpdateSchema>

export const EMPTY_MEMORY: TimelineMemory = {}

// True when nothing is stored — used to keep the column null rather than persisting
// an empty object, so `memory IS NULL` stays a meaningful "never touched".
export function isEmptyMemory(m: TimelineMemory): boolean {
  return !Object.values(m).some((v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.length > 0 : v != null))
}

// Field-scoped merge. Only keys present in `patch` are written; `appendRun`
// prepends (newest first) and trims to the bound. Pure so both the server fn and
// the MCP tool share one implementation and cannot drift.
export function mergeTimelineMemory(current: TimelineMemory | null, patch: TimelineMemoryUpdate): TimelineMemory {
  const base: TimelineMemory = { ...(current ?? {}) }
  const { appendRun, ...fields } = patch

  for (const [k, v] of Object.entries(fields)) {
    // An explicitly-passed empty string / empty array clears the field.
    if (typeof v === 'string' && v.length === 0) delete base[k as keyof TimelineMemory]
    else if (Array.isArray(v) && v.length === 0) delete base[k as keyof TimelineMemory]
    else (base as Record<string, unknown>)[k] = v
  }

  if (appendRun) {
    base.runs = [appendRun, ...(current?.runs ?? [])].slice(0, MEMORY_LIMITS.runs)
  }

  return base
}
