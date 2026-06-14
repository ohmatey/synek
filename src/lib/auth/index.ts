import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, mcp } from 'better-auth/plugins'
import { db } from '~/lib/db'
import * as schema from '~/lib/db/schema'
import { sendEmail, verificationEmailTemplate, resetPasswordEmailTemplate } from './email'

// Full Better Auth, single local user. Two credential paths to the MCP endpoint:
//  1. The `mcp` plugin makes this app a loopback OAuth provider — Claude Code
//     dynamically registers, the user clicks "Authorize", and the issued bearer is
//     an OAuth access token (the lovable, no-paste path).
//  2. The `bearer` plugin + named api keys (`synek_…`) remain for the stdio server
//     and as a static fallback. `bun run issue:key` still mints one.
const YEAR_SECONDS = 60 * 60 * 24 * 365

export const BASE_URL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3001}`

// The MCP resource these OAuth tokens are scoped to (must match the plugin's
// `.mcp.json` endpoint). Advertised in the protected-resource metadata.
export const MCP_RESOURCE = `${BASE_URL}/api/mcp`

export const auth = betterAuth({
  baseURL: BASE_URL,
  // Local-first default so the app runs without setup; set BETTER_AUTH_SECRET in prod.
  secret: process.env.BETTER_AUTH_SECRET || 'synek-local-dev-secret-change-me-0000000000',
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: {
    enabled: true,
    // Hosted v1: open signup. Don't BLOCK login on verification (avoids lockout if
    // mail delivery is flaky) — we still send the verification mail + nudge, and a
    // one-flag flip to true tightens it later.
    requireEmailVerification: false,
    // Self-serve password reset. The email link lands on /reset-password?token=…
    // (redirectTo below); no-ops to a console warning if RESEND_API_KEY is unset.
    sendResetPassword: async ({ user, url }) => {
      const t = resetPasswordEmailTemplate(url)
      await sendEmail({ to: user.email, subject: t.subject, html: t.html })
    },
  },
  // Send a verification mail on signup (non-blocking — see requireEmailVerification).
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      const t = verificationEmailTemplate(url)
      await sendEmail({ to: user.email, subject: t.subject, html: t.html })
    },
  },
  // Long expiry so the minted token behaves like a stable API key.
  session: { expiresIn: YEAR_SECONDS, updateAge: YEAR_SECONDS },
  plugins: [
    bearer(),
    // OAuth front door for MCP clients. `loginPage` is where an unauthenticated
    // user is sent to sign in (home shows the auth forms when logged out); after
    // that the plugin's built-in consent screen handles the "Authorize" click.
    mcp({ loginPage: '/', resource: MCP_RESOURCE }),
  ],
})
