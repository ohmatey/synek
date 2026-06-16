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
  try {
    await server.connect(transport)
    // Body is fully buffered before handleRequest resolves, so teardown (finally) is safe.
    return await transport.handleRequest(request)
  } catch (err) {
    // LAST-RESORT GUARD: anything the SDK/transport throws becomes a controlled
    // JSON-RPC error Response, never an unhandled rejection out of the route. An
    // unhandled rejection here is what 500s the request and crashes `bun run dev`.
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: `internal error: ${message}` } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
    // LOAD-BEARING: the posthog-node singleton lives at module scope across
    // requests. Flush the just-enqueued tool event now or it could be lost on
    // idle/crash. No-op when no analytics key is set. Never let a flush error throw.
    await flushAnalytics().catch(() => {})
  }
}
