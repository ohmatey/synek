import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createApiKey as dbCreateApiKey,
  listApiKeys as dbListApiKeys,
  revokeApiKey as dbRevokeApiKey,
  ensureDefaultApiKey as dbEnsureDefaultApiKey,
  type ApiKeySummary,
} from '~/lib/auth/api-keys'
import { requireUser } from '~/lib/auth/session'

// Client RPCs for the home Keys panel. Every handler requires an authenticated
// user (so hiding the UI isn't the only protection) and scopes keys to that user.
// The raw secret is returned only from createApiKey / the first-run Default.

export const listApiKeys = createServerFn({ method: 'GET' }).handler(async (): Promise<ApiKeySummary[]> => {
  const user = await requireUser()
  return dbListApiKeys(user.id)
})

// Drives the panel: returns the signed-in user's keys and, on their first visit,
// a freshly minted "Default" key's show-once secret.
export const initApiKeys = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ created: { raw: string; key: ApiKeySummary } | null; keys: ApiKeySummary[] }> => {
    const user = await requireUser()
    return dbEnsureDefaultApiKey(user.id)
  },
)

export const createApiKey = createServerFn({ method: 'POST' })
  .inputValidator((d: { label: string }) => z.object({ label: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ data }): Promise<{ raw: string; key: ApiKeySummary }> => {
    const user = await requireUser()
    return dbCreateApiKey(data.label, user.id)
  })

export const revokeApiKey = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbRevokeApiKey(data, user.id)
    return { ok: true as const }
  })
