import { auth } from './index'
import { looksLikeApiKey, verifyApiKey } from './api-keys'

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized: missing or invalid API key' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

const BEARER = /^Bearer\s+(.+)$/i

// Authorize a Bearer token: a named api key (`synek_…`, hashed + revocable) takes
// precedence; anything else falls back to a Better Auth session token (legacy
// tokens from `bun run issue:key` / the old reveal flow keep working).
async function isAuthorized(token: string | undefined, headers: Headers): Promise<boolean> {
  if (token && looksLikeApiKey(token)) {
    if (verifyApiKey(token)) return true
    // A revoked/unknown api key is a hard no — don't fall through to sessions.
    return false
  }
  return !!(await auth.api.getSession({ headers }))
}

const bearerToken = (headers: Headers): string | undefined => headers.get('authorization')?.match(BEARER)?.[1]?.trim()

// HTTP guard: validate the Bearer credential before any MCP tool runs. Returns a
// 401 Response to short-circuit, or null when authorized.
export async function requireApiKey(request: Request): Promise<Response | null> {
  const ok = await isAuthorized(bearerToken(request.headers), request.headers)
  return ok ? null : unauthorized()
}

// stdio guard: validate STRATA_API_KEY (an api key or a legacy session token)
// before connecting the transport.
export async function assertApiKey(token: string | undefined): Promise<void> {
  if (!token) throw new Error('STRATA_API_KEY is required for the MCP stdio server')
  const ok = await isAuthorized(token, new Headers({ authorization: `Bearer ${token}` }))
  if (!ok)
    throw new Error(
      'STRATA_API_KEY is invalid, revoked, or expired — create one in the app’s Keys panel or run `bun run issue:key`',
    )
}
