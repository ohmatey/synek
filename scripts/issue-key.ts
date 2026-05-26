import { issueLocalToken } from '../src/lib/auth/token'

// Print the local user's long-lived session token — the "API key" the MCP client
// uses. Idempotent. Run under Node (tsx): `bun run issue:key` dispatches to tsx.
async function main() {
  const token = await issueLocalToken()
  console.log('\nSTRATA API KEY (session token) — copy into .env as STRATA_API_KEY and into your MCP client:\n')
  console.log(token)
  console.log('\nConnect a client to http://localhost:3001/api/mcp with header  Authorization: Bearer <token>\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
