import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

// Better Auth core tables (user/session/account/verification) — kept in this
// schema so they share the project's drizzle-kit migration pipeline.
import {
  user,
  session,
  account,
  verification,
  oauthApplication,
  oauthAccessToken,
  oauthConsent,
} from './auth-schema'
export { user, session, account, verification, oauthApplication, oauthAccessToken, oauthConsent }

import {
  NODE_TYPES,
  EDGE_KINDS,
  PRECISIONS,
  POV_TYPES,
  DEPTH_TIERS,
  STORY_STATUS,
  SEGMENT_KINDS,
  STORY_LENSES,
  CITATION_SOURCE_TYPES,
  SOURCE_TYPES,
  ARTIFACT_TYPES,
  RELIABILITY,
  STORY_ARTIFACT_REL,
  type CitationSourceType,
  type GeoScope,
  type NodeImage,
  type NodeSize,
  type NodeSubtype,
  type ProjectKind,
  type ProjectWorld,
  type StoryBeatWidget,
  type StoryCastMember,
  type StoryImage,
  type TimelineTheme,
  type TimelineViewSettings,
} from '~/lib/domain/types'

import { PROJECT_KINDS } from '~/lib/domain/types'
import type { BrandKit } from '~/lib/domain/brand'

export type Citation = { title: string; url?: string; quote?: string; sourceType?: CitationSourceType }
export type NodeMetadata = {
  citations?: Citation[]
  color?: string
  images?: NodeImage[]
  size?: NodeSize
  subtype?: NodeSubtype
  // Swimlane grouping key (e.g. "OpenAI"). Nodes sharing a lane render in one
  // horizontal row-group on the canvas; absent → laid out by node type.
  lane?: string
  // Where this happened — a plain display string ("Golgotha, Jerusalem").
  // Display-only; no geocoding (a map lens can interpret it later).
  location?: string
  // Optional geo coordinates for `location` (decimal degrees) — the globe lens
  // plots them; the display string is independent. MCP-client-supplied (no
  // geocoding). lat ∈ [-90, 90] (negative = South), lng ∈ [-180, 180]
  // (negative = West). Absent → the node has no point on the globe.
  lat?: number
  lng?: number
  // Explicit "cannot be pinned" marker, mutually exclusive with lat/lng —
  // records that the node was reviewed and has no single place ('global' /
  // 'diffuse' / 'unknown'). Coverage math counts these as resolved, so the
  // globe backfill loop converges instead of re-litigating them forever.
  geoScope?: GeoScope
}
export type EdgeMetadata = Record<string, unknown>

const newId = () => crypto.randomUUID()
const now = () => new Date()

// --- brands: a LOCAL, owner-authored brand kit (stories-first slice 2) -----
// Synek adopts the Realscript brand SCHEMA so a kit authored here is shape-
// compatible with Realscript's `get_brand_kit` output (BrandKit in
// domain/brand.ts). LEAN: this is the local-authoring half only — NO Realscript
// fetch, NO encrypted Realscript key, NO MCP brand tools, NO sync (all LATER).
// Reuses the shipped ownerId ownership/isolation pattern verbatim. A project links
// to AT MOST one brand (projects.brandId, SET NULL on delete); a brand can dress
// many projects. The kit blob is whole-object replace-on-write (like
// timelines.theme) — never a Patch.
export const brands = sqliteTable(
  'brands',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner. Nullable for migration safety (matches projects/timelines.ownerId);
    // new brands ALWAYS set it. Reads are owner-scoped, fail-closed.
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // URL/handle slug. Global-unique (same posture as projects.slug); the creating
    // server fn slugifies the name and dedupes on collision. Immutable across rename.
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    // The full brand kit (identity + visual identity + guidelines + voice schema),
    // validated by brandKitSchema. Null until the editor saves one — a fresh brand
    // is just a named shell. Whole-object replace-write; NOT in the Patch stack.
    kit: text('kit', { mode: 'json' }).$type<BrandKit>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [index('brands_owner_id_idx').on(t.ownerId)],
)

export type BrandRow = typeof brands.$inferSelect

// --- projects: the top-level owned container (ADR 0002 D1) -----------------
// Sits between `user` and `timelines`, carrying the project-level metadata every
// later phase reads. Reuses the shipped ownerId ownership/isolation pattern
// verbatim (nullable ownerId, owner-scoped reads, fail-closed) so verify:isolation
// extends with zero new machinery. Project CRUD is metadata — NOT in the Patch
// stack (D9); the Patch engine knows nothing about projects.
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner. Nullable for migration safety (matches timelines.ownerId /
    // artifacts.ownerId); new projects ALWAYS set it. Reads are owner-scoped,
    // fail-closed — a null-owner row never surfaces.
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // URL handle (D6). Global-unique; the creating server fn slugifies the title
    // and dedupes on collision (the slugify-then-dedupe the story path uses).
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    // Truth model (D2). Default 'nonfiction'; fiction is P4-additive — the app
    // does not branch on kind in slice 1 beyond defaulting it.
    kind: text('kind', { enum: PROJECT_KINDS }).notNull().default('nonfiction'),
    // World/basemap config (D3). null == real Earth. RESERVED seam for P4 — slice
    // 1 leaves it null for every project.
    world: text('world', { mode: 'json' }).$type<ProjectWorld>(),
    // Opaque external Realscript brand id (D4). NO FK — it lives in another system
    // on another stack; integration is by contract, not co-location. Set in P2.
    // DISTINCT from `brandId` below: `brandRef` is the REMOTE Realscript handle
    // (sync, later); `brandId` is a LOCAL Synek-authored brand kit (slice 2).
    brandRef: text('brand_ref'),
    // The LOCAL Synek brand kit this project is dressed by (slice 2). Owner-scoped
    // FK to `brands`; SET NULL on brand delete so deleting a kit never deletes the
    // project — it just unlinks. Nullable: a project may carry no kit. Linking is
    // double-owner-checked (project AND brand must be the caller's) in the db layer.
    brandId: text('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    // Project-level default theme (D5). SAME shape as timelines.theme
    // (TimelineTheme), so timelineThemeSchema validates it for free. Timelines
    // inherit at READ time (timeline.theme ?? project.theme ?? defaults) — no new
    // column on timelines, no theme-data migration.
    theme: text('theme', { mode: 'json' }).$type<TimelineTheme>(),
    // The project's BUILT-IN brand kit (identity + visual reference + voice), on
    // Realscript's brand schema (BrandKit in domain/brand.ts). Folds the former
    // author-many-kits-and-link model (the dormant `brands` table + `brandId`) into
    // a single kit the project OWNS — themes/voice are now built into the project,
    // not a separate library. Null until the project's branding editor saves one.
    // Read by the story "brand costume" path (getTimelineBrandInfo) for on-brand
    // writing; the visual *render* still comes from `theme` above.
    brand: text('brand', { mode: 'json' }).$type<BrandKit>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [index('projects_owner_id_idx').on(t.ownerId)],
)

export type ProjectRow = typeof projects.$inferSelect

export const timelines = sqliteTable(
  'timelines',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner of the timeline. Nullable for migration safety; new timelines always
    // set it. Each account owns many timelines (no separate "workspace" entity).
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // The project this timeline belongs to (ADR 0002 D7). Added NULLABLE for
    // migration safety (matches ownerId) + backfilled to the owner's default
    // project. The write path (createTimeline) ALWAYS sets it; reads tolerate null
    // (an owner's null-project timelines surface under their default project), so a
    // backfill miss degrades gracefully instead of orphaning. NOT made NOT-NULL in
    // slice 1 — promoting it is a later verified-rebuild hardening migration.
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    // Sharing: private by default. When true, anyone with the URL can view it
    // read-only (no login). Only the owner can edit or toggle this.
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    description: text('description'),
    // Owner-saved display defaults (the time-axis scale) applied on open.
    viewSettings: text('view_settings', { mode: 'json' }).$type<TimelineViewSettings>(),
    // Owner-saved visual theme (freeform accents, canvas wash, font, texture +
    // AI imageStyle/mood). Separate from viewSettings: both setters are whole-
    // object replace-writes, so sharing a column would have each clobber the other.
    theme: text('theme', { mode: 'json' }).$type<TimelineTheme>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [
    index('timelines_owner_id_idx').on(t.ownerId),
    index('timelines_project_id_idx').on(t.projectId),
  ],
)

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

// Per-user app settings (Phase 2, hosted multi-user). One row per user, upserted.
// Holds the user's BYO OpenRouter key — ENCRYPTED at rest (AES-GCM via
// lib/crypto/secrets.ts; the plaintext never leaves the server, never reaches the
// client) — plus their chosen agent model. Self-host/local needs none of this
// (the operator env key + default model still work).
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  // AES-GCM blob (v1:salt:iv:tag:ct), or null when the user hasn't set a key.
  openRouterKeyEnc: text('openrouter_key_enc'),
  // First chars of the raw key, for display only ("sk-or-v1-abc…"). Never the secret.
  openRouterKeyPrefix: text('openrouter_key_prefix'),
  // The user's chosen OpenRouter model slug; null → fall back to the env default.
  agentModel: text('agent_model'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export type UserSettingsRow = typeof userSettings.$inferSelect

// --- Shared entities (ADR 0004) -------------------------------------------
// Canonical CONTENT for a node, decoupled from any one timeline. One entity can
// back MANY placements (`nodes.entityId`) across timelines; editing it propagates
// to every placement via the loadGraph overlay (no fan-out writes). Owner-scoped
// (the security boundary), like timelines. NB: an `entities` row backs ANY node
// TYPE (event/entity/period/concept) — it is "canonical node content," distinct
// from the `entity` NodeType. Carries CONTENT only; `lane`/`laneHint` are
// per-placement and stay on `nodes`.
export const entities = sqliteTable('entities', {
  id: text('id').primaryKey().$defaultFn(newId),
  ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  type: text('type', { enum: NODE_TYPES }).notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  startInstant: integer('start_instant').notNull(),
  endInstant: integer('end_instant'),
  precision: text('precision', { enum: PRECISIONS }).notNull().default('year'),
  // Content metadata only (citations/images/size/color/subtype/location/lat/lng/
  // geoScope) — NOT `lane`, which is per-placement and lives on `nodes.metadata`.
  metadata: text('metadata', { mode: 'json' }).$type<NodeMetadata>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  // The canonical entity this placement renders (ADR 0004). Nullable: legacy/test
  // bare nodes resolve from their own columns (the loadGraph overlay falls back
  // when this is null). App writes (add_node) always set it.
  entityId: text('entity_id').references(() => entities.id),
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

// The SEPARATE undo stack for shared-entity CONTENT edits (ADR 0004), keyed by
// entityId+seq — independent of the per-timeline `patches`/⌘Z stack. An entity
// content edit propagates to every placement, so its undo history can't live on
// any one timeline. Cascades when the entity is deleted.
export const entityPatches = sqliteTable('entity_patches', {
  id: text('id').primaryKey().$defaultFn(newId),
  entityId: text('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(), // monotonic per entity — orders this entity's stack
  summary: text('summary').notNull(),
  ops: text('ops', { mode: 'json' }).$type<EntityOp[]>().notNull(),
  inverseOps: text('inverse_ops', { mode: 'json' }).$type<EntityOp[]>().notNull(),
  status: text('status', { enum: ['applied', 'undone'] })
    .notNull()
    .default('applied'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// --- Story layer (S1) -----------------------------------------------------
// "Moment" is the product word for an existing `node`; the story layer hangs
// off `nodes.id` so the Patch/undo engine is untouched. Stories are NOT graph
// Patches — generation is a separate, provenance-tracked flow.
//
// Undo-faithful across the cascade: `momentId` cascades on node delete, so deleting
// a moment (or undoing the patch that created it) drops its story rows. To keep the
// Patch engine's undo faithful WITHOUT teaching it about stories, the delete's
// inverse (an `add_node` op) carries a captured StorySnapshot that `applyOp`
// re-inserts alongside the restored node — captured/restored in db/patches.ts
// (captureStories/restoreStory). The story tables themselves stay outside the
// Patch engine.

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
  // Optional cover art for the reader's cover panel (layout field ignored here).
  coverImage: text('cover_image', { mode: 'json' }).$type<StoryImage>(),
  // The story's cast: node-backed members ({ nodeId }) are clickable/tourable;
  // name-only members ({ name }) exist in prose but have no node yet — the MCP
  // write_story tool warns about those so the client can materialize them.
  cast: text('cast', { mode: 'json' }).$type<StoryCastMember[]>(),
  // The story's OWN visual theme (same TimelineTheme shape as timelines.theme).
  // Independent of the timeline's — resolved at READ time as a fallback chain
  // (story.theme ?? timeline.theme ?? project.theme ?? defaults), so a story can
  // carry its own look or inherit the timeline's. Replace-on-write, null clears,
  // NOT on the Patch stack — set via the set_story_theme tool / setStoryTheme RPC.
  theme: text('theme', { mode: 'json' }).$type<TimelineTheme>(),
  status: text('status', { enum: STORY_STATUS }).notNull().default('draft'),
  // Per-story PUBLIC visibility — INDEPENDENT of timelines.isPublic. The /s/$slug
  // page gates on THIS, so sharing one story never exposes its whole timeline, and
  // making the timeline private never breaks an already-shared story link. Default
  // private; flipped by setStoryShared / the reader's Share control. Only the nodes
  // a story references ship to the public page (no full-graph leak).
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
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
  // The single entity this beat spotlights: as the reader steps here, the canvas
  // pans + rings it and the entity panel beside the story switches to show it.
  // Soft ref (a node id on the same timeline), no FK — like relatedNodeIds; the UI
  // falls back to the moment when it's null or dangling.
  focusNodeId: text('focus_node_id'),
  // The canvas surface this beat plays on while reading — 'globe' | 'timeline', or
  // null = auto (derive from the focus node's location). Lets a story switch surfaces
  // beat-to-beat for an immersive read. See StoryLens.
  lens: text('lens', { enum: STORY_LENSES }),
  // S2 slice 1 — per-beat source grounding. Same shape as a node's
  // `metadata.citations` (Citation), stored inline as JSON (no join table yet —
  // see .can/prd/s2-artifact-grounding.md for the deferred normalized model).
  citations: text('citations', { mode: 'json' }).$type<Citation[]>(),
  // Optional art for this beat; `layout` picks the reader treatment
  // (full / inset-left / inset-right / bleed). Sourced like node images: a
  // real, web-accessible URL — never generated.
  image: text('image', { mode: 'json' }).$type<StoryImage>(),
  // Optional LIVE widget for this beat — a mini timeline / globe / entity card
  // referencing node ids, resolved at read time so it stays live as the graph
  // changes. Renders as the panel's hero visual in the sharable public reader.
  widget: text('widget', { mode: 'json' }).$type<StoryBeatWidget>(),
  speakerPersonId: text('speaker_person_id').references(() => people.id), // null in S1 (S4)
  generationId: text('generation_id').references(() => generations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// --- S2 artifact grounding (ADR 0001) -------------------------------------
// Reusable primary-source reference data. Sources + artifacts are CRUD (never
// graph Patches). The three join tables wire artifacts to stories / moments /
// beats. Citation storage is single-home-per-citation: an artifact-backed
// citation lives only in `segment_citations`; an unregistered one-off mention
// lives only in `story_segments.citations` (the inline JSON). See ADR 0001.

// Bibliographic record (a book, an archive, a museum collection).
export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner (Phase 2 multi-tenant). Nullable for migration safety; new rows always set
    // it. Reads are owner-scoped (fail-closed: a null-owner row never surfaces).
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // "Home project" (ADR 0002 D8). Nullable + write-path-enforced + indexed,
    // backfilled via the linked artifact's project. NOT a reuse fence — owner-scope
    // still governs search/citation; this is organizational grouping within an owner.
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    author: text('author'),
    // Publication year — a plain int, NOT a timeline instant. Sources are not plotted.
    year: integer('year'),
    citation: text('citation'), // formatted bibliographic string
    url: text('url'),
    sourceType: text('source_type', { enum: SOURCE_TYPES }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [index('sources_project_id_idx').on(t.projectId)],
)

// The reusable primary-source objects that ground beats. Addressed by id; no slug.
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // Owner (Phase 2 multi-tenant). Nullable for migration safety; new rows always
    // set it. Corpus reads (search, by-id, citation validation) filter by owner —
    // fail-closed, so a null-owner row never leaks across tenants.
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // "Home project" (ADR 0002 D8). Nullable + write-path-enforced + indexed,
    // backfilled via the first linked timeline's project. NOT a reuse fence — an
    // artifact reused across projects keeps ONE home project; owner-scope still
    // governs search/citation, so reuse can still cross within an owner.
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(), // "Tablet 291: Claudia Severa's birthday invitation"
    artifactType: text('artifact_type', { enum: ARTIFACT_TYPES }).notNull(),
    // Domain time (instant + precision), BCE-safe — canvas-placeable via instantToX.
    dateInstant: integer('date_instant'), // when the artifact was MADE (epoch-ms, negative = BCE)
    datePrecision: text('date_precision', { enum: PRECISIONS }).notNull().default('year'),
    transcript: text('transcript'), // the actual text content (FTS-indexed)
    translation: text('translation'), // if from another language (FTS-indexed)
    imageUrl: text('image_url'), // sourced URL, never generated (matches node-image rule)
    // Provenance distance (rank/filter handle) + free-text nuance.
    reliability: text('reliability', { enum: RELIABILITY }),
    reliabilityNote: text('reliability_note'),
    // Genre of source — reuse the existing Citation enum, orthogonal to reliability.
    sourceType: text('artifact_source_type', { enum: CITATION_SOURCE_TYPES }),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
    attributedPersonId: text('attributed_person_id').references(() => people.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  },
  (t) => [
    index('artifacts_title_idx').on(t.title), // dedupe-by-title on curation/upsert
    index('artifacts_source_id_idx').on(t.sourceId),
    index('artifacts_owner_id_idx').on(t.ownerId), // owner-scoped corpus search
    index('artifacts_project_id_idx').on(t.projectId),
  ],
)

// Stories anchored/referenced/backgrounded by artifacts (composite PK).
export const storyArtifacts = sqliteTable(
  'story_artifacts',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    relationship: text('relationship', { enum: STORY_ARTIFACT_REL }).notNull().default('referenced'),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.artifactId] }), index('story_artifacts_artifact_idx').on(t.artifactId)],
)

// Artifact <-> node/moment — the canvas-lens + artifact-first link. Powers
// "objects placed in time" and "this artifact belongs to this point" independent
// of any story (a moment can carry artifacts before any story exists).
export const momentArtifacts = sqliteTable(
  'moment_artifacts',
  {
    momentId: text('moment_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    note: text('note'), // optional "why this artifact sits here"
  },
  (t) => [primaryKey({ columns: [t.momentId, t.artifactId] }), index('moment_artifacts_artifact_idx').on(t.artifactId)],
)

// A beat <-> the artifact that grounds it (composite PK). The artifact-backed
// citation tier; `excerptUsed` is the specific passage the beat draws on.
export const segmentCitations = sqliteTable(
  'segment_citations',
  {
    segmentId: text('segment_id')
      .notNull()
      .references(() => storySegments.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    excerptUsed: text('excerpt_used'),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.artifactId] }),
    index('segment_citations_artifact_idx').on(t.artifactId),
  ],
)

export type SourceRow = typeof sources.$inferSelect
export type ArtifactRow = typeof artifacts.$inferSelect
export type StoryArtifactRow = typeof storyArtifacts.$inferSelect
export type MomentArtifactRow = typeof momentArtifacts.$inferSelect
export type SegmentCitationRow = typeof segmentCitations.$inferSelect

export type TimelineRow = typeof timelines.$inferSelect
export type EntityRow = typeof entities.$inferSelect
export type EntityPatchRow = typeof entityPatches.$inferSelect
export type NodeRow = typeof nodes.$inferSelect
export type EdgeRow = typeof edges.$inferSelect
export type PatchRow = typeof patches.$inferSelect
export type PromptTemplateRow = typeof promptTemplates.$inferSelect
export type GenerationRow = typeof generations.$inferSelect
export type PersonRow = typeof people.$inferSelect
export type StoryRow = typeof stories.$inferSelect
export type StorySegmentRow = typeof storySegments.$inferSelect

// A story (+ its ordered segments) captured at delete time so an undo can restore
// it. Stories live outside the Patch engine and cascade on node delete, so without
// this an undo/redo would lose them (see db/patches.ts). The join rows that hang
// off the story (`story_artifacts` off the story, `segment_citations` off each
// segment) cascade away too, so they ride along in the snapshot — keyed by
// segmentId for the citations so restore can pair them to each re-inserted beat
// (ADR 0001, Decision 7 / two-site undo capture).
export type StorySnapshot = {
  story: StoryRow
  segments: StorySegmentRow[]
  storyArtifacts: StoryArtifactRow[]
  segmentCitations: Record<string, SegmentCitationRow[]>
}

// A single reversible graph mutation. Updates carry before/after; deletes carry
// the full row(s) so they can be restored. invertPatch = ops.map(invert).reverse().
// `add_node.stories` is set only on the op that RESTORES a deleted moment (the
// inverse of a delete) — it re-inserts ALL the cascaded stories (a moment can hold
// several) so undo/redo stays faithful. Legacy patch rows may carry a single
// `story` instead; the restore path accepts both (see db/patches.ts).
// `add_node.momentArtifacts` is the node-side companion to `stories`: the
// `moment_artifacts` links that hang off the node itself (not a story) and
// cascade on delete. Set only on a restore (delete-inverse) op so undo/redo
// brings a moment's artifact links back (ADR 0001 — two-site undo capture).
// `add_node.entity` (ADR 0004) carries the canonical entity row co-created with a
// brand-new placement, so undo can remove it and redo re-create it. It is absent
// when the op only PLACES an existing entity (the entity already exists and is
// shared). `delete_node.entity` is the companion: the entity snapshot to
// CONDITIONALLY remove on apply (only if this was its last placement) and to
// restore on undo — mirrors the stories/momentArtifacts two-site capture.
export type GraphOp =
  | {
      kind: 'add_node'
      node: NodeRow
      entity?: EntityRow | null
      stories?: StorySnapshot[] | null
      story?: StorySnapshot | null
      momentArtifacts?: MomentArtifactRow[] | null
    }
  | { kind: 'update_node'; id: string; before: Partial<NodeRow>; after: Partial<NodeRow> }
  | { kind: 'delete_node'; node: NodeRow; edges: EdgeRow[]; entity?: EntityRow | null }
  | { kind: 'add_edge'; edge: EdgeRow }
  | { kind: 'update_edge'; id: string; before: Partial<EdgeRow>; after: Partial<EdgeRow> }
  | { kind: 'delete_edge'; edge: EdgeRow }

// A single reversible ENTITY-content mutation (ADR 0004), on the per-entity
// `entity_patches` stack. Content-only; placement/lane never appears here.
export type EntityOp = {
  kind: 'update_entity'
  before: Partial<EntityRow>
  after: Partial<EntityRow>
}
