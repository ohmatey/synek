import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user } from '../src/lib/db/schema'
import { createApiKey } from '../src/lib/auth/api-keys'

// Mint a named MCP API key for a user and print its secret ONCE. Multi-user: the
// key is owned by a registered account. Pass an email to target a specific user;
// otherwise the first/only user is used. Run under Node (tsx): `bun run issue:key`.
//
//   bun run issue:key                      # first user, label "CLI key"
//   bun run issue:key me@example.com       # that user
//   bun run issue:key me@example.com "Laptop CLI"
function main() {
  const args = process.argv.slice(2)
  const email = args[0]?.includes('@') ? args[0] : undefined
  const label = (email ? args[1] : args[0])?.trim() || 'CLI key'

  const owner = email
    ? db.select().from(user).where(eq(user.email, email)).get()
    : db.select().from(user).get()

  if (!owner) {
    console.error(
      email
        ? `No user with email "${email}". Sign up in the app first (Connect panel → Create account).`
        : 'No users yet. Sign up in the app first (home page → "Connect an MCP client" → Create account).',
    )
    process.exit(1)
  }

  const { raw, key } = createApiKey(label, owner.id)
  console.log(`\nSYNEK API KEY "${key.label}" for ${owner.email} — shown once. Copy into .env as STRATA_API_KEY:\n`)
  console.log(raw)
  console.log('\nConnect a client to http://localhost:3001/api/mcp with header  Authorization: Bearer <key>')
  console.log('Manage or revoke keys anytime in the app’s "Connect an MCP client" panel.\n')
  process.exit(0)
}

main()
