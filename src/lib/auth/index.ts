import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer } from 'better-auth/plugins'
import { db } from '~/lib/db'
import * as schema from '~/lib/db/schema'

// Full Better Auth, single local user. Better Auth 1.6 has no api-key plugin, so
// the credential is a long-lived SESSION TOKEN delivered via the `bearer` plugin
// (built for non-browser clients): the MCP client sends `Authorization: Bearer <token>`.
// Mint one with `bun run issue:key`. The token is the user-facing "API key".
const YEAR_SECONDS = 60 * 60 * 24 * 365

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3001}`,
  // Local-first default so the app runs without setup; set BETTER_AUTH_SECRET in prod.
  secret: process.env.BETTER_AUTH_SECRET || 'synek-local-dev-secret-change-me-0000000000',
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true },
  // Long expiry so the minted token behaves like a stable API key.
  session: { expiresIn: YEAR_SECONDS, updateAge: YEAR_SECONDS },
  plugins: [bearer()],
})
