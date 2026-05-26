import { createApiKey } from '../src/lib/auth/api-keys'

// Mint a named MCP API key and print its secret ONCE. Each run creates a fresh
// `synek_…` key (revoke old ones in the app's Keys panel). Run under Node (tsx):
// `bun run issue:key` dispatches to tsx.
async function main() {
  const label = process.argv[2]?.trim() || 'CLI key'
  const { raw, key } = createApiKey(label)
  console.log(`\nSYNEK API KEY "${key.label}" — shown once. Copy into .env as STRATA_API_KEY and into your MCP client:\n`)
  console.log(raw)
  console.log('\nConnect a client to http://localhost:3001/api/mcp with header  Authorization: Bearer <key>')
  console.log('Manage or revoke keys anytime in the app’s "Connect an MCP client" panel.\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
