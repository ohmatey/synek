import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'

// Vite's SSR module loader runs under Node, so we use better-sqlite3 (a Node
// driver) rather than bun:sqlite. Sync API; works under both Node and Bun.
const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : process.env.DATABASE_URL || 'local.db'

export const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
// The app and the stdio MCP server can open this file concurrently — wait for a
// lock instead of throwing SQLITE_BUSY. (Still: one primary writer at a time.)
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })

// Apply migrations on startup (idempotent). Generate with `bun run db:generate`.
//
// Locating the `drizzle/` folder: under dev/tsx, `import.meta.url` points at this
// source file so the repo-relative path resolves. In the BUNDLED production server
// (dist/server/server.js) it does NOT — so honor `SYNEK_MIGRATIONS_DIR` (set in the
// container) and fall back to <cwd>/drizzle. We key on the migrations journal so a
// stray empty dir can't masquerade as the folder.
//
// Fail LOUD in production: a silently-unmigrated prod DB serving an empty schema is
// far worse than refusing to boot. In dev a missing folder is fine (none generated
// yet); `migrate()` itself is idempotent, so re-running an applied set is a no-op.
const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = [
  process.env.SYNEK_MIGRATIONS_DIR,
  path.resolve(here, '../../../drizzle'),
  path.resolve(process.cwd(), 'drizzle'),
]
  .filter((p): p is string => Boolean(p))
  .find((p) => existsSync(path.join(p, 'meta', '_journal.json')))

if (migrationsDir) {
  migrate(db, { migrationsFolder: migrationsDir })
} else if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'No drizzle migrations folder found — set SYNEK_MIGRATIONS_DIR. Refusing to start ' +
      'against a possibly-unmigrated database.',
  )
}
