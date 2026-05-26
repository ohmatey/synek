import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '~/lib/mcp/http'
import { requireApiKey } from '~/lib/auth/guard'

// The MCP endpoint. External clients (Claude Desktop / Claude Code) connect here
// with an API key and drive timeline create/manage via the MCP tools. Stateless
// Streamable HTTP — see src/lib/mcp/http.ts.
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => (await requireApiKey(request)) ?? handleMcpRequest(request),
    },
  },
})
