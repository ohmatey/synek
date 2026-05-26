import { randomBytes, createHash } from 'node:crypto'
import { eq, desc } from 'drizzle-orm'
import { db } from '~/lib/db'
import { apiKeys, type ApiKeyRow } from '~/lib/db/schema'

// Named, hashed, revocable MCP access keys for the single local user.
//
// The raw secret is `synek_<32 random bytes, base64url>`. It is returned ONCE at
// creation and never stored — only its sha256 hash (for lookup) and a short
// display prefix persist. Validation hashes the presented token and matches a
// non-revoked row. See lib/auth/guard.ts for how this slots ahead of the Better
// Auth session fallback.

export const API_KEY_PREFIX = 'synek_'
const DISPLAY_PREFIX_LEN = 12 // chars of the raw key kept for display (incl. `synek_`)

const hashKey = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** True for tokens that look like an api key (vs a legacy Better Auth session token). */
export const looksLikeApiKey = (token: string): boolean => token.startsWith(API_KEY_PREFIX)

/** A safe-to-display view of a key (never includes the secret or its hash). */
export type ApiKeySummary = {
  id: string
  label: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

const toSummary = (r: ApiKeyRow): ApiKeySummary => ({
  id: r.id,
  label: r.label,
  prefix: r.prefix,
  createdAt: r.createdAt.getTime(),
  lastUsedAt: r.lastUsedAt ? r.lastUsedAt.getTime() : null,
  revokedAt: r.revokedAt ? r.revokedAt.getTime() : null,
})

/**
 * Mint a new key. Returns the raw secret (show ONCE) and the stored summary.
 * The raw secret is not recoverable afterwards.
 */
export function createApiKey(label: string): { raw: string; key: ApiKeySummary } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString('base64url')
  const row = db
    .insert(apiKeys)
    .values({ label: label.trim() || 'Untitled key', keyHash: hashKey(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) })
    .returning()
    .get()
  return { raw, key: toSummary(row) }
}

/** All keys, newest first, as display-safe summaries. */
export function listApiKeys(): ApiKeySummary[] {
  return db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)).all().map(toSummary)
}

/** Revoke a key by id (idempotent). Future MCP calls with it will 401. */
export function revokeApiKey(id: string): void {
  db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)).run()
}

/**
 * Validate a presented raw token against the stored keys. Returns the row when a
 * non-revoked key matches (and stamps lastUsedAt), else null. Only call for tokens
 * that `looksLikeApiKey` — legacy session tokens go through Better Auth instead.
 */
export function verifyApiKey(token: string): ApiKeyRow | null {
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(token))).get()
  if (!row || row.revokedAt) return null
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).run()
  return row
}
