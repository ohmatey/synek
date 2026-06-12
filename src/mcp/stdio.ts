import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer } from '~/lib/mcp/server'
import { assertApiKey } from '~/lib/auth/guard'
import { shutdownAnalytics } from '~/lib/posthog/server'

// Standalone stdio MCP server (same buildMcpServer() as the HTTP route). Launched
// by a client like Claude Desktop via tsx. better-sqlite3 is a native Node addon,
// so this must run under Node (tsx), never `bun` directly.
//
// NOTE: this opens the same SQLite file as the web app. WAL + busy_timeout make
// concurrent reads safe, but run only ONE primary writer at a time (app OR stdio).
async function main() {
  const ownerId = await assertApiKey(process.env.SYNEK_API_KEY)
  const server = buildMcpServer(ownerId)
  // Long-lived process: the batch flush interval covers steady state; flush + stop
  // on shutdown so a closing client (e.g. Claude Desktop) doesn't drop the last
  // batch. No-op when no analytics key is set.
  for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit'] as const) {
    process.once(sig, () => {
      void shutdownAnalytics().finally(() => process.exit(0))
    })
  }
  await server.connect(new StdioServerTransport())
}

main().catch(async (e) => {
  console.error(e)
  await shutdownAnalytics()
  process.exit(1)
})
