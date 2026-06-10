import { createFileRoute } from '@tanstack/react-router'
import { oAuthDiscoveryMetadata } from 'better-auth/plugins'
import { auth } from '~/lib/auth'

// RFC 8414 OAuth Authorization Server metadata, served at the DOMAIN ROOT so an
// MCP client (Claude Code) can discover this app's OAuth endpoints. Better Auth's
// `mcp` plugin builds the document; we just expose it here.
const handler = oAuthDiscoveryMetadata(auth)

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
