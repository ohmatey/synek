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

// The dev-only fallback secret. Fine for `bun run dev` / a local single-user
// download; FATAL on an exposed deploy (anyone who knows it can forge sessions),
// which is why the guard below refuses to boot if it leaks into production.
const DEV_FALLBACK_SECRET = 'synek-local-dev-secret-change-me-0000000000'

export const BASE_URL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3001}`

// The MCP resource these OAuth tokens are scoped to (must match the plugin's
// `.mcp.json` endpoint). Advertised in the protected-resource metadata.
// With BETTER_AUTH_URL = the public HTTPS origin, this resolves to
// `https://<origin>/api/mcp` — the value the synek plugin's remote OAuth expects.
export const MCP_RESOURCE = `${BASE_URL}/api/mcp`

// "Exposed mode" = this process is (or is being configured as) a real, public-facing
// deploy, not a local download. Two independent signals, either one trips it:
//   1. NODE_ENV=production — set by the prod Dockerfile (Vite dev never sets this).
//   2. BETTER_AUTH_URL points at a non-localhost origin — the operator has declared
//      a public origin, so the deploy is reachable by others.
// In exposed mode the dev-secret fallback is a forgery hole, so we fail loud instead
// of booting insecurely. In plain local dev (neither signal) ergonomics are intact.
function isExposedDeploy(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  const url = process.env.BETTER_AUTH_URL?.trim()
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    const isLoopback =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost')
    return !isLoopback
  } catch {
    // An unparseable BETTER_AUTH_URL is itself a misconfiguration worth surfacing;
    // treat it as exposed so the guard reports it rather than silently degrading.
    return true
  }
}

// Fail-loud guard: refuse to boot an exposed deploy on the insecure dev secret.
// Reversible (env/secret fix), and the failure is the safe state — better a crashed
// boot the operator must fix than a public app anyone can forge sessions against.
function resolveAuthSecret(): string {
  const provided = process.env.BETTER_AUTH_SECRET?.trim()
  const exposed = isExposedDeploy()
  if (exposed) {
    if (!provided) {
      throw new Error(
        '[synek] BETTER_AUTH_SECRET is required for an exposed deploy (NODE_ENV=production ' +
          'or a non-localhost BETTER_AUTH_URL) and is missing. Sessions would be signed with ' +
          'a public dev secret and could be forged. Provide it via the deploy secret mechanism ' +
          '(on sector137: a sealed-secret env, `openssl rand -base64 32`). Refusing to boot.',
      )
    }
    if (provided === DEV_FALLBACK_SECRET) {
      throw new Error(
        '[synek] BETTER_AUTH_SECRET equals the known public dev fallback on an exposed deploy. ' +
          'This secret is in source control — anyone can forge sessions with it. Set a real one ' +
          'via the deploy secret mechanism (on sector137: a sealed-secret env, ' +
          '`openssl rand -base64 32`). Refusing to boot.',
      )
    }
    return provided
  }
  // Local dev: use the operator's secret if given, else the documented dev fallback.
  return provided || DEV_FALLBACK_SECRET
}

// Fail-loud guard: SYNEK_LOCAL_MODE bypasses the login wall and auto-signs every
// request in as the single shared local user (src/lib/auth/local-mode.ts). That is
// exactly right for a local download and a TOTAL per-user-isolation bypass on an
// exposed deploy — every visitor would land in the same account and see everyone's
// data. Refuse to boot if both are true. Reversible (unset the env), and the crash
// is the safe state. Local dev is untouched: SYNEK_LOCAL_MODE on a localhost origin
// is not "exposed", so the guard never trips.
function assertLocalModeNotExposed(): void {
  const localMode = process.env.SYNEK_LOCAL_MODE?.trim()
  const localModeOn = localMode === '1' || localMode?.toLowerCase() === 'true'
  if (localModeOn && isExposedDeploy()) {
    throw new Error(
      '[synek] SYNEK_LOCAL_MODE is set on an exposed deploy (NODE_ENV=production or a ' +
        'non-localhost BETTER_AUTH_URL). It skips the login wall and signs every visitor in ' +
        'as the one shared local user — a total per-user-isolation bypass. Unset SYNEK_LOCAL_MODE ' +
        'on any hosted/multi-tenant deploy. Refusing to boot.',
    )
  }
}

assertLocalModeNotExposed()

export const auth = betterAuth({
  baseURL: BASE_URL,
  secret: resolveAuthSecret(),
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
