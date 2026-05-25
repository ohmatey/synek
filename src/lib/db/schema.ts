import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { NODE_TYPES, EDGE_KINDS, PRECISIONS, type NodeImage, type NodeSize } from '~/lib/domain/types'

export type Citation = { title: string; url?: string; quote?: string }
export type NodeMetadata = { citations?: Citation[]; color?: string; images?: NodeImage[]; size?: NodeSize }
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

// A chat thread within a timeline. The canvas/graph is shared across threads;
// "New chat" opens a fresh thread without wiping the old one, and History lists
// them. Title starts as a default and is set from the first user message.
export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

// Persisted chat transcript per thread — so reloading restores the conversation
// that built the canvas, not just the graph. `parts` holds the AI SDK UIMessage
// parts (text + tool-invocation parts) verbatim. `sessionId` is nullable in the
// column only because SQLite can't add a NOT NULL column to a populated table;
// the app always sets it (a startup backfill adopts pre-sessions rows).
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(newId),
  timelineId: text('timeline_id')
    .notNull()
    .references(() => timelines.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(), // the UIMessage's own id (stable React key)
  seq: integer('seq').notNull(), // order within the thread
  role: text('role', { enum: ['system', 'user', 'assistant'] }).notNull(),
  parts: text('parts', { mode: 'json' }).$type<unknown[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(now).notNull(),
})

export type TimelineRow = typeof timelines.$inferSelect
export type NodeRow = typeof nodes.$inferSelect
export type EdgeRow = typeof edges.$inferSelect
export type PatchRow = typeof patches.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type ChatSessionRow = typeof chatSessions.$inferSelect

// A single reversible graph mutation. Updates carry before/after; deletes carry
// the full row(s) so they can be restored. invertPatch = ops.map(invert).reverse().
export type GraphOp =
  | { kind: 'add_node'; node: NodeRow }
  | { kind: 'update_node'; id: string; before: Partial<NodeRow>; after: Partial<NodeRow> }
  | { kind: 'delete_node'; node: NodeRow; edges: EdgeRow[] }
  | { kind: 'add_edge'; edge: EdgeRow }
  | { kind: 'update_edge'; id: string; before: Partial<EdgeRow>; after: Partial<EdgeRow> }
  | { kind: 'delete_edge'; edge: EdgeRow }
