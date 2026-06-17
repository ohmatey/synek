import { auth } from './index'
import { LOCAL_USER_EMAIL as EMAIL, LOCAL_USER_PASSWORD as PASSWORD } from './local-mode'

// The single local user that owns the MCP access token. Local-first, single-user:
// the app trusts whoever runs it. Override via env (SYNEK_USER_EMAIL /
// SYNEK_USER_PASSWORD — see local-mode.ts) for a custom local identity.

// Mint (or refresh) the local user's long-lived session token — the "API key"
// an MCP client sends as `Authorization: Bearer <token>`. Idempotent: creates the
// user if absent, then signs in. Server-only (imports the DB-backed auth instance).
export async function issueLocalToken(): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Local' } })
  } catch {
    // user already exists — fine
  }
  const { headers, response } = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    returnHeaders: true,
  })
  const token = (response as { token?: string }).token || headers.get('set-auth-token')
  if (!token) throw new Error('Could not obtain a session token from Better Auth')
  return token
}
