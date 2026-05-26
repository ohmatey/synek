import { createServerFn } from '@tanstack/react-start'
import { issueLocalToken } from '~/lib/auth/token'

// In-app way to get the MCP access token (so users don't need the CLI). Returns
// the local user's bearer token for the "Connect" panel on the home page.
// Local-first trust model: this is unauthenticated because the app already trusts
// whoever can open it locally — same assumption as `bun run issue:key`.
export const getMcpToken = createServerFn({ method: 'POST' }).handler(async (): Promise<{ token: string }> => {
  return { token: await issueLocalToken() }
})
