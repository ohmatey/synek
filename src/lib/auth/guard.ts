import { auth, BASE_URL } from './index'
import { looksLikeApiKey, verifyApiKey } from './api-keys'

// 401 that points OAuth-capable clients (Claude Code) at our protected-resource
// metadata per RFC 9728 — this `WWW-Authenticate` header is what makes the client
// kick off the browser "Authorize" flow instead of just failing.
const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized: missing or invalid credential' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    },
  })

const BEARER = /^Bearer\s+(.+)$/i

// Resolve the OWNER user id behind a Bearer credential, or null if unauthorized.
// Three credential shapes, in priority order:
//  1. A named api key (`synek_…`, hashed + revocable) — used by the stdio server
//     and as a static fallback. A revoked/unknown one is a hard no.
//  2. An OAuth access token from the `mcp` plugin's browser flow (the default for
//     the Claude Code plugin) — validated via getMcpSession.
//  3. A legacy Better Auth session token. The owner id scopes every MCP op.
async function resolveUserId(token: string | undefined, headers: Headers): Promise<string | null> {
  if (token && looksLikeApiKey(token)) {
    const row = verifyApiKey(token)
    return row?.userId ?? null
  }
  // OAuth access token (Claude Code → "Authorize" → token). getMcpSession reads the
  // Bearer header itself; it returns null (or throws) for non-OAuth tokens.
  try {
    const mcpSession = await auth.api.getMcpSession({ headers })
    if (mcpSession?.userId) return mcpSession.userId
  } catch {
    // not an OAuth token — fall through
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

// stdio guard: validate SYNEK_API_KEY (an api key or a legacy session token) and
// return the owner user id, or throw.
export async function assertApiKey(token: string | undefined): Promise<string> {
  if (!token) throw new Error('SYNEK_API_KEY is required for the MCP stdio server')
  const userId = await resolveUserId(token, new Headers({ authorization: `Bearer ${token}` }))
  if (!userId)
    throw new Error(
      'SYNEK_API_KEY is invalid, revoked, or expired — create one in the app’s Keys panel or run `bun run issue:key`',
    )
  return userId
}
