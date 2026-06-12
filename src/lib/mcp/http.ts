import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildMcpServer } from './server'
import { flushAnalytics } from '~/lib/posthog/server'

// Stateless Streamable-HTTP: a fresh server + transport per request, so there's
// no session store and no transport-reuse hazard. `enableJsonResponse` returns
// one buffered JSON-RPC response (our tools are synchronous — no SSE needed).
export async function handleMcpRequest(request: Request, ownerId: string): Promise<Response> {
  const server = buildMcpServer(ownerId)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  // Safe to tear down now: the body is fully buffered before handleRequest resolves.
  await transport.close()
  await server.close()
  // LOAD-BEARING: this request scope ends here, but the posthog-node singleton
  // lives at module scope across requests. Flush the just-enqueued tool event now
  // or it could be lost on idle/crash (the server/transport teardown above does
  // not flush it). No-op when no analytics key is set.
  await flushAnalytics()
  return response
}
