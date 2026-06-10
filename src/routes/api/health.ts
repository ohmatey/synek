import { createFileRoute } from '@tanstack/react-router'

// Liveness probe. The canvas polls this so it can show whether the app (and thus
// the MCP HTTP endpoint at /api/mcp) is reachable — the precondition for an MCP
// client to build a timeline. Unauthenticated and side-effect free.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
})
