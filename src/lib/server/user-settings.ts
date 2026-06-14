import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireUser } from '~/lib/auth/session'
import {
  getUserSettingsRow,
  setUserOpenRouterKey,
  clearUserOpenRouterKey,
  setUserAgentModel,
} from '~/lib/db/user-settings'
import { encryptSecret, secretsConfigured } from '~/lib/crypto/secrets'

// Per-user agent settings (Phase 2 BYO key). All requireUser-gated. The plaintext
// OpenRouter key is accepted, encrypted, and stored — it is NEVER returned to the
// client (only a display prefix + a hasKey flag).

export type UserAgentSettings = {
  hasOpenRouterKey: boolean
  openRouterKeyPrefix: string | null
  agentModel: string | null
  // Whether the server can store secrets at all (SYNEK_SECRETS_KEY present).
  canStoreKey: boolean
}

export const getUserSettings = createServerFn({ method: 'GET' }).handler(async (): Promise<UserAgentSettings> => {
  const user = await requireUser()
  const row = getUserSettingsRow(user.id)
  return {
    hasOpenRouterKey: !!row?.openRouterKeyEnc,
    openRouterKeyPrefix: row?.openRouterKeyPrefix ?? null,
    agentModel: row?.agentModel ?? null,
    canStoreKey: secretsConfigured(),
  }
})

const keyInput = z.object({ key: z.string().min(1) })
export const setOpenRouterKey = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof keyInput>) => keyInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; prefix: string } | { ok: false; error: string }> => {
    const user = await requireUser()
    if (!secretsConfigured()) {
      return { ok: false, error: 'This server can’t store keys — SYNEK_SECRETS_KEY is not set.' }
    }
    const raw = data.key.trim()
    setUserOpenRouterKey(user.id, encryptSecret(raw), raw.slice(0, 12))
    return { ok: true, prefix: raw.slice(0, 12) }
  })

export const clearOpenRouterKey = createServerFn({ method: 'POST' }).handler(async (): Promise<{ ok: true }> => {
  const user = await requireUser()
  clearUserOpenRouterKey(user.id)
  return { ok: true }
})

const modelInput = z.object({ model: z.string() })
export const setAgentModel = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof modelInput>) => modelInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser()
    setUserAgentModel(user.id, data.model.trim() || null)
    return { ok: true }
  })
