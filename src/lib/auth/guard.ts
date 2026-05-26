import { auth } from './index'

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized: missing or invalid API key' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

// HTTP guard: validate the Bearer token (the minted session token) before any MCP
// tool runs. Returns a 401 Response to short-circuit, or null when authorized.
export async function requireApiKey(request: Request): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  return session ? null : unauthorized()
}

// stdio guard: validate STRATA_API_KEY before connecting the transport.
export async function assertApiKey(token: string | undefined): Promise<void> {
  if (!token) throw new Error('STRATA_API_KEY is required for the MCP stdio server')
  const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
  if (!session) throw new Error('STRATA_API_KEY is invalid or expired — mint a new one with `bun run issue:key`')
}
