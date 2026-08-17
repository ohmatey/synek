#!/usr/bin/env node
// Dump one timeline's graph from the local SQLite DB as the `get_timeline` JSON
// shape, so it can be piped into grade-timeline.mjs without a running server.
// Reads are safe alongside the app (WAL). Run under `node` (better-sqlite3 is a
// Node-ABI binding, so Bun can't load it).
//
// Usage:
//   node dump-timeline.mjs <timelineId> [--db path/to.db] > graph.json
//   node dump-timeline.mjs <timelineId> | node grade-timeline.mjs - --multi-track

import Database from 'better-sqlite3'

const argv = process.argv.slice(2)
const id = argv.find((a) => !a.startsWith('--'))
const dbFlag = argv.indexOf('--db')
const dbPath = dbFlag !== -1 ? argv[dbFlag + 1] : process.env.DATABASE_URL || 'local.db'

if (!id) {
  console.error('usage: dump-timeline.mjs <timelineId> [--db path]')
  process.exit(2)
}

const db = new Database(dbPath, { readonly: true })
const title = db.prepare('select title from timelines where id = ?').get(id)?.title ?? null
const rows = db.prepare('select * from nodes where timeline_id = ?').all(id)
const edgeRows = db.prepare('select * from edges where timeline_id = ?').all(id)

const nodes = rows.map((r) => ({
  id: r.id,
  type: r.type,
  title: r.title,
  summary: r.summary,
  startInstant: r.start_instant,
  endInstant: r.end_instant,
  precision: r.precision,
  metadata: r.metadata ? JSON.parse(r.metadata) : null,
}))
const edges = edgeRows.map((e) => ({
  id: e.id,
  sourceId: e.source_id,
  targetId: e.target_id,
  kind: e.kind,
  label: e.label,
}))

process.stdout.write(JSON.stringify({ title, nodes, edges }, null, 2) + '\n')
