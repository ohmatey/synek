import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '~/lib/mcp/http'
import { mcpLandingResponse } from '~/lib/mcp/landing'
import { requireApiKey } from '~/lib/auth/guard'

// The MCP endpoint. External clients (Claude Desktop / Claude Code) connect here
// with an API key and drive timeline create/manage via the MCP tools. Stateless
// Streamable HTTP — see src/lib/mcp/http.ts.
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApiKey(request)
        if (auth instanceof Response) return auth
        return handleMcpRequest(request, auth.userId)
      },
      // A browser GET has no JSON-RPC to act on — serve a setup/use guide instead
      // of the blank SPA shell. Agents/curl get a JSON descriptor; MCP clients
      // probing for a GET SSE stream get a 405. See src/lib/mcp/landing.ts.
      GET: ({ request }) => mcpLandingResponse(request),
    },
  },
})
