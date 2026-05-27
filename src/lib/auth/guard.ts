import { auth } from './index'
import { looksLikeApiKey, verifyApiKey } from './api-keys'

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized: missing or invalid API key' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

const BEARER = /^Bearer\s+(.+)$/i

// Resolve the OWNER user id behind a Bearer credential, or null if unauthorized.
// A named api key (`synek_…`, hashed + revocable) takes precedence and yields its
// owner; otherwise we fall back to a Better Auth session token (legacy tokens from
// `bun run issue:key` / the old reveal flow) and use its user id. The owner id
// scopes every MCP operation to that user's timelines.
async function resolveUserId(token: string | undefined, headers: Headers): Promise<string | null> {
  if (token && looksLikeApiKey(token)) {
    const row = verifyApiKey(token)
    // A revoked/unknown/unowned api key is a hard no — don't fall through to sessions.
    return row?.userId ?? null
  }
  const session = await auth.api.getSession({ headers })
  return session?.user?.id ?? null
}

const bearerToken = (headers: Headers): string | undefined => headers.get('authorization')?.match(BEARER)?.[1]?.trim()

// HTTP guard: resolve the owner from the Bearer credential before any MCP tool
// runs. Returns `{ userId }` when authorized, or a 401 Response to short-circuit.
export async function requireApiKey(request: Request): Promise<{ userId: string } | Response> {
  const userId = await resolveUserId(bearerToken(request.headers), request.headers)
  return userId ? { userId } : unauthorized()
}

// stdio guard: validate STRATA_API_KEY (an api key or a legacy session token) and
// return the owner user id, or throw.
export async function assertApiKey(token: string | undefined): Promise<string> {
  if (!token) throw new Error('STRATA_API_KEY is required for the MCP stdio server')
  const userId = await resolveUserId(token, new Headers({ authorization: `Bearer ${token}` }))
  if (!userId)
    throw new Error(
      'STRATA_API_KEY is invalid, revoked, or expired — create one in the app’s Keys panel or run `bun run issue:key`',
    )
  return userId
}
