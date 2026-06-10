import { createFileRoute } from '@tanstack/react-router'
import { oAuthProtectedResourceMetadata } from 'better-auth/plugins'
import { auth } from '~/lib/auth'

// RFC 9728 Protected Resource metadata for the MCP endpoint. The 401 from
// /api/mcp points here via WWW-Authenticate; this document tells the client which
// authorization server to use. Built by Better Auth's `mcp` plugin.
const handler = oAuthProtectedResourceMetadata(auth)

export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
