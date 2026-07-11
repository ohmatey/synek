import { createServerFn } from '@tanstack/react-start'
import { issueLocalToken } from '~/lib/auth/token'
import { isLocalMode } from '~/lib/auth/local-mode'

// In-app way to get the MCP access token (so users don't need the CLI). Returns
// the local user's bearer token for the "Connect" panel on the home page.
// Local-first trust model: unauthenticated because the app already trusts whoever
// can open it locally — same assumption as `bun run issue:key`.
//
// GATED to local mode ONLY. issueLocalToken() mints a year-long bearer for the
// deterministic `local@synek.app` account (hardcoded password in local-mode.ts);
// left ungated this would be an unauthenticated credential-minting endpoint that
// hands any caller a working token for that shared account on an exposed deploy —
// a tenant-isolation hole. Off local mode there is no "local user" to vend: hosted
// users authenticate and mint a named key via the requireUser-gated api-key RPCs
// (or use the OAuth flow). Mirrors ensureLocalSession's isLocalMode() gate.
export const getMcpToken = createServerFn({ method: 'POST' }).handler(async (): Promise<{ token: string }> => {
  if (!isLocalMode()) throw new Error('unavailable: sign in and mint a named API key, or use the OAuth flow')
  return { token: await issueLocalToken() }
})
