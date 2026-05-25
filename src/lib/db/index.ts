import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import path from 'node:path'
import * as schema from './schema'

// In-memory for tests; a local file otherwise.
const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : process.env.DATABASE_URL || 'local.db'

export const sqlite = new Database(dbPath)
sqlite.run('PRAGMA journal_mode = WAL')
sqlite.run('PRAGMA foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// Apply migrations on startup (idempotent). Generate them with `bun run db:generate`.
try {
  migrate(db, { migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle') })
} catch {
  // No migrations generated yet, or already applied — fine for local dev.
}
