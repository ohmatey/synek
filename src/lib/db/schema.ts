import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// Better Auth core tables (user/session/account/verification) — kept in this
// schema so they share the project's drizzle-kit migration pipeline.
import { user, session, account, verification } from './auth-schema'
export { user, session, account, verification }

import {
  NODE_TYPES,
  EDGE_KINDS,
  PRECISIONS,
  POV_TYPES,
  DEPTH_TIERS,
  STORY_STATUS,
  SEGMENT_KINDS,
  type NodeImage,
  type NodeSize,
  type NodeSubtype,
} from '~/lib/domain/types'

export type Citation = { title: string; url?: string; quote?: string }
export type NodeMetadata = {
  citations?: Citation[]
  color?: string
  images?: NodeImage[]
  size?: NodeSize
  subtype?: NodeSubtype
}
export type EdgeMetadata = Record<string, unknown>

const newId = () => crypto.randomUUID()
const now = () => new Date()

export const timelines = sqliteTable('timelines', {
  id: text('id').primaryKey().$defaultFn(newId),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// MCP access keys — named, hashed, revocable credentials for the single local
// user. The raw secret (`synek_<base64url>`) is shown once at creation and never
// stored; only its sha256 hash + a short display prefix persist. The MCP guard
// checks these first, then falls back to Better Auth sessions for legacy tokens
// (see lib/auth/guard.ts). Postgres-portable, same conventions as the rest.
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner of the key. Nullable for pre-multi-user rows; new keys always set it.
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    keyHash: text('key_hash').notNull(), // sha256(rawKey) hex — the secret is never stored
    prefix: text('prefix').notNull(), // first chars of the raw key, for display only
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }), // non-null = revoked
  },
  (t) => [index('api_keys_key_hash_idx').on(t.keyHash), index('api_keys_user_id_idx').on(t.userId)],
)

export type ApiKeyRow = typeof apiKeys.$inferSelect

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  type: text('type', { enum: NODE_TYPES }).notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  // Domain time as a sortable epoch-ms instant (negative = BCE) + a precision.
  // History needs fuzzy/ancient dates ("Q3 2008", "49 BCE"), not a JS Date.
  startInstant: integer('start_instant').notNull(),
  endInstant: integer('end_instant'), // null for Event; set for Entity/Period spans
  precision: text('precision', { enum: PRECISIONS }).notNull().default('year'),
  laneHint: integer('lane_hint'),
  metadata: text('metadata', { mode: 'json' }).$type<NodeMetadata>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const edges = sqliteTable('edges', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  sourceId: text('source_id')
    .notNull()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  targetId: text('target_id')
    .notNull()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: EDGE_KINDS }).notNull(),
  label: text('label'),
  metadata: text('metadata', { mode: 'json' }).$type<EdgeMetadata>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// The undo/redo crux: one user turn commits as one Patch (forward + inverse ops).
export const patches = sqliteTable('patches', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(), // monotonic per timeline — orders the stack
  summary: text('summary').notNull(),
  ops: text('ops', { mode: 'json' }).$type<GraphOp[]>().notNull(),
  inverseOps: text('inverse_ops', { mode: 'json' }).$type<GraphOp[]>().notNull(),
  status: text('status', { enum: ['applied', 'undone'] })
    .notNull()
    .default('applied'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// --- Story layer (S1) -----------------------------------------------------
// "Moment" is the product word for an existing `node`; the story layer hangs
// off `nodes.id` so the Patch/undo engine is untouched. Stories are NOT graph
// Patches — generation is a separate, provenance-tracked flow.

// Provenance generation targets/purposes are server-only (not client-reachable).
export const GEN_TARGETS = ['story', 'segment', 'interior', 'hook', 'voice', 'image'] as const
export const GEN_PURPOSES = ['story', 'segment', 'interior', 'hook', 'image', 'voice'] as const

// Built day one so it never has to be retrofitted across thousands of rows.
export const promptTemplates = sqliteTable('prompt_templates', {
  id: text('id').primaryKey().$defaultFn(newId),
  name: text('name').notNull(), // 'generate_story_v1'
  version: integer('version').notNull().default(1),
  purpose: text('purpose', { enum: GEN_PURPOSES }).notNull(),
  body: text('body').notNull(), // template with placeholders
  systemPrompt: text('system_prompt'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    targetKind: text('target_kind', { enum: GEN_TARGETS }).notNull(),
    targetId: text('target_id'), // polymorphic — no FK by design
    cacheKey: text('cache_key'), // hash(templateId, promptInputs) — indexed for dedupe
    model: text('model').notNull(), // 'anthropic/claude-sonnet-4-6'
    promptTemplateId: text('prompt_template_id').references(() => promptTemplates.id),
    promptInputsJson: text('prompt_inputs_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    // Generic cached output. Stories keep content in their own tables; image/voice
    // have no domain table, so the result (e.g. { dataUrl }) is cached here by cacheKey.
    outputJson: text('output_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costCents: integer('cost_cents'),
    latencyMs: integer('latency_ms'),
    humanReviewed: integer('human_reviewed', { mode: 'boolean' }).notNull().default(false),
    reviewerNotes: text('reviewer_notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => ({ cacheKeyIdx: index('gen_cache_key_idx').on(t.cacheKey) }),
)

// Minimal scaffold in S1 (omniscient stories don't populate it); enriched in S3/S4.
export const people = sqliteTable('people', {
  id: text('id').primaryKey().$defaultFn(newId),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  fullName: text('full_name'),
  birthYear: integer('birth_year'), // plain year int — people are not on the axis
  deathYear: integer('death_year'),
  role: text('role'),
  isHistorical: integer('is_historical', { mode: 'boolean' }).notNull().default(true),
  shortBio: text('short_bio'),
  portraitUrl: text('portrait_url'),
  voiceProfileId: text('voice_profile_id'), // for TTS later; unused in S1
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const stories = sqliteTable('stories', {
  id: text('id').primaryKey().$defaultFn(newId),
  momentId: text('moment_id')
    .notNull()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(), // "Anna and the Books"
  hook: text('hook'), // one-liner shown on the moment
  povType: text('pov_type', { enum: POV_TYPES }).notNull().default('omniscient'), // S1: always omniscient
  depthTier: text('depth_tier', { enum: DEPTH_TIERS }).notNull().default('light'),
  estimatedMinutes: integer('estimated_minutes'),
  primaryPersonId: text('primary_person_id').references(() => people.id), // null in S1
  status: text('status', { enum: STORY_STATUS }).notNull().default('draft'),
  language: text('language').notNull().default('en'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const storySegments = sqliteTable('story_segments', {
  id: text('id').primaryKey().$defaultFn(newId),
  storyId: text('story_id')
    .notNull()
    .references(() => stories.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(), // ordering within the story
  kind: text('kind', { enum: SEGMENT_KINDS }).notNull().default('narration'),
  bodyText: text('body_text').notNull(),
  audioUrl: text('audio_url'), // optional pre-gen TTS; unused in S1
  settingNote: text('setting_note'), // "rain on cobblestones, smell of woodsmoke"
  relatedNodeIds: text('related_node_ids', { mode: 'json' }).$type<string[]>(), // beat → tappable map links
  speakerPersonId: text('speaker_person_id').references(() => people.id), // null in S1 (S4)
  generationId: text('generation_id').references(() => generations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export type TimelineRow = typeof timelines.$inferSelect
export type NodeRow = typeof nodes.$inferSelect
export type EdgeRow = typeof edges.$inferSelect
export type PatchRow = typeof patches.$inferSelect
export type PromptTemplateRow = typeof promptTemplates.$inferSelect
export type GenerationRow = typeof generations.$inferSelect
export type PersonRow = typeof people.$inferSelect
export type StoryRow = typeof stories.$inferSelect
export type StorySegmentRow = typeof storySegments.$inferSelect

// A single reversible graph mutation. Updates carry before/after; deletes carry
// the full row(s) so they can be restored. invertPatch = ops.map(invert).reverse().
export type GraphOp =
  | { kind: 'add_node'; node: NodeRow }
  | { kind: 'update_node'; id: string; before: Partial<NodeRow>; after: Partial<NodeRow> }
  | { kind: 'delete_node'; node: NodeRow; edges: EdgeRow[] }
  | { kind: 'add_edge'; edge: EdgeRow }
  | { kind: 'update_edge'; id: string; before: Partial<EdgeRow>; after: Partial<EdgeRow> }
  | { kind: 'delete_edge'; edge: EdgeRow }
