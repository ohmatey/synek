import { randomBytes, createHash } from 'node:crypto'
import { eq, and, desc } from 'drizzle-orm'
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
 * Mint a new key owned by `userId`. Returns the raw secret (show ONCE) and the
 * stored summary. The raw secret is not recoverable afterwards.
 */
export function createApiKey(label: string, userId: string): { raw: string; key: ApiKeySummary } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString('base64url')
  const row = db
    .insert(apiKeys)
    .values({
      userId,
      label: label.trim() || 'Untitled key',
      keyHash: hashKey(raw),
      prefix: raw.slice(0, DISPLAY_PREFIX_LEN),
    })
    .returning()
    .get()
  return { raw, key: toSummary(row) }
}

/** A user's keys, newest first, as display-safe summaries. */
export function listApiKeys(userId: string): ApiKeySummary[] {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
    .all()
    .map(toSummary)
}

/**
 * First-run convenience: if no keys exist yet (none ever created — revoked rows
 * still count, so this never resurrects after a full revoke), mint a "Default"
 * key and return its show-once secret alongside the list. Otherwise `created` is
 * null. Lets a brand-new user land with a ready-to-copy key instead of an empty
 * panel, without ever silently creating a key whose secret can't be seen.
 */
export function ensureDefaultApiKey(userId: string): {
  created: { raw: string; key: ApiKeySummary } | null
  keys: ApiKeySummary[]
} {
  const existing = db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
    .all()
  if (existing.length > 0) return { created: null, keys: existing.map(toSummary) }
  const created = createApiKey('Default', userId)
  return { created, keys: [created.key] }
}

/** Revoke one of `userId`'s keys (idempotent; scoped so you can't revoke another
 * user's key). Future MCP calls with it will 401. */
export function revokeApiKey(id: string, userId: string): void {
  db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .run()
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
