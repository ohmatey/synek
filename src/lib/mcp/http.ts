import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildMcpServer } from './server'

// Stateless Streamable-HTTP: a fresh server + transport per request, so there's
// no session store and no transport-reuse hazard. `enableJsonResponse` returns
// one buffered JSON-RPC response (our tools are synchronous — no SSE needed).
export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = buildMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  // Safe to tear down now: the body is fully buffered before handleRequest resolves.
  await transport.close()
  await server.close()
  return response
}
