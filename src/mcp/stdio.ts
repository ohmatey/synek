import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer } from '~/lib/mcp/server'
import { assertApiKey } from '~/lib/auth/guard'

// Standalone stdio MCP server (same buildMcpServer() as the HTTP route). Launched
// by a client like Claude Desktop via tsx. better-sqlite3 is a native Node addon,
// so this must run under Node (tsx), never `bun` directly.
//
// NOTE: this opens the same SQLite file as the web app. WAL + busy_timeout make
// concurrent reads safe, but run only ONE primary writer at a time (app OR stdio).
async function main() {
  const ownerId = await assertApiKey(process.env.SYNEK_API_KEY)
  const server = buildMcpServer(ownerId)
  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
