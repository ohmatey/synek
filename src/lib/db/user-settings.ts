import { eq } from 'drizzle-orm'
import { db } from './index'
import { userSettings, type UserSettingsRow } from './schema'

// Per-user app settings (Phase 2). One row per user, created on first write. Holds
// the user's encrypted BYO OpenRouter key + chosen agent model. The encryption /
// decryption lives in lib/crypto/secrets.ts; this layer only stores the blob.

export function getUserSettingsRow(userId: string): UserSettingsRow | null {
  return db.select().from(userSettings).where(eq(userSettings.userId, userId)).get() ?? null
}

type SettingsPatch = Partial<Pick<UserSettingsRow, 'openRouterKeyEnc' | 'openRouterKeyPrefix' | 'agentModel'>>

// Upsert the given columns for a user (insert the row on first write, else update).
function upsert(userId: string, patch: SettingsPatch): void {
  const updatedAt = new Date()
  db.insert(userSettings)
    .values({ userId, ...patch, updatedAt })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt } })
    .run()
}

export function setUserOpenRouterKey(userId: string, enc: string, prefix: string): void {
  upsert(userId, { openRouterKeyEnc: enc, openRouterKeyPrefix: prefix })
}

export function clearUserOpenRouterKey(userId: string): void {
  upsert(userId, { openRouterKeyEnc: null, openRouterKeyPrefix: null })
}

export function setUserAgentModel(userId: string, model: string | null): void {
  upsert(userId, { agentModel: model })
}
