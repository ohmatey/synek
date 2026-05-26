import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createApiKey as dbCreateApiKey,
  listApiKeys as dbListApiKeys,
  revokeApiKey as dbRevokeApiKey,
  ensureDefaultApiKey as dbEnsureDefaultApiKey,
  type ApiKeySummary,
} from '~/lib/auth/api-keys'

// Client RPCs for the home Keys panel. The raw secret is returned only from
// createApiKey / the first-run Default (show once); list/revoke never expose it.

export const listApiKeys = createServerFn({ method: 'GET' }).handler((): ApiKeySummary[] => dbListApiKeys())

// Drives the panel: returns the current keys and, on first run only, a freshly
// minted "Default" key's show-once secret.
export const initApiKeys = createServerFn({ method: 'POST' }).handler(
  (): { created: { raw: string; key: ApiKeySummary } | null; keys: ApiKeySummary[] } => dbEnsureDefaultApiKey(),
)

export const createApiKey = createServerFn({ method: 'POST' })
  .inputValidator((d: { label: string }) => z.object({ label: z.string().trim().min(1).max(80) }).parse(d))
  .handler(({ data }): { raw: string; key: ApiKeySummary } => dbCreateApiKey(data.label))

export const revokeApiKey = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(({ data }) => {
    dbRevokeApiKey(data)
    return { ok: true as const }
  })
