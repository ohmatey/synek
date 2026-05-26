import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'
// Safe despite the cycle (sessions.ts imports `db` below): it reads `db` only
// inside functions, and we call backfillSessions() after `db` is assigned.
import { backfillSessions } from './sessions'

// Vite's SSR module loader runs under Node, so we use better-sqlite3 (a Node
// driver) rather than bun:sqlite. Sync API; works under both Node and Bun.
const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : process.env.DATABASE_URL || 'local.db'

export const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// Apply migrations on startup (idempotent). Generate with `bun run db:generate`.
try {
  const here = path.dirname(fileURLToPath(import.meta.url))
  migrate(db, { migrationsFolder: path.resolve(here, '../../../drizzle') })
  // Adopt any pre-sessions transcript into a session (idempotent no-op otherwise).
  backfillSessions()
} catch {
  // No migrations generated yet, or already applied — fine for local dev.
}
