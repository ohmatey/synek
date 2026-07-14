import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, mcp } from 'better-auth/plugins'
import { db } from '~/lib/db'
import * as schema from '~/lib/db/schema'
import { sendEmail, verificationEmailTemplate, resetPasswordEmailTemplate } from './email'
import { isLocalMode } from './local-mode'

// Full Better Auth, single local user. Two credential paths to the MCP endpoint:
//  1. The `mcp` plugin makes this app a loopback OAuth provider — Claude Code
//     dynamically registers, the user clicks "Authorize", and the issued bearer is
//     an OAuth access token (the lovable, no-paste path).
//  2. The `bearer` plugin + named api keys (`synek_…`) remain for the stdio server
//     and as a static fallback. `bun run issue:key` still mints one.
const DAY_SECONDS = 60 * 60 * 24
// Web login: a ROLLING 30-day session. It expires 30 days after the last use, and
// each visit within that window refreshes it (updateAge < expiresIn = sliding), so
// an active user stays signed in indefinitely while an idle one is logged out after
// 30 days. The login form's "Stay logged in" checkbox is the per-login override:
// unchecked passes `rememberMe: false`, which makes the cookie a browser-session
// cookie (cleared on browser close) instead of persisting for this window.
// (MCP `synek_…` keys are a SEPARATE system — see api-keys.ts — and are unaffected.)
const SESSION_EXPIRES_IN = 30 * DAY_SECONDS
const SESSION_UPDATE_AGE = DAY_SECONDS

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

// Better Auth rejects any request whose Origin isn't trusted (enforced once the
// request carries a cookie — i.e. every real browser call after the first visit).
// BASE_URL is always trusted. In LOCAL DEV ONLY, also trust ANY loopback port:
// the dev server's port is fluid (3001 via .env, 3456 via launch.json, 5173 the
// Vite default) while BASE_URL is pinned, so a fixed port would still 403 whenever
// they disagree. `http://localhost:*` matches any port on that loopback host and
// is boundary-safe (a colon must follow "localhost", so localhost.evil.com and
// userinfo tricks like localhost:x@evil.com don't match — Better Auth resolves to
// the real origin first). Never broadened on an exposed deploy: isExposedDeploy()
// keeps prod strict at BASE_URL only.
function resolveTrustedOrigins(): string[] {
  const origins = new Set<string>([BASE_URL])
  if (!isExposedDeploy()) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      origins.add(`http://${host}:*`)
      origins.add(`https://${host}:*`)
    }
  }
  return [...origins]
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
  // Reuse isLocalMode() — the SAME parse the auto-sign-in gate uses (local-mode.ts).
  // A divergent inline check here would let a flag value the gate honours (e.g. "yes")
  // slip past the guard, re-opening the exact bypass this exists to close.
  if (isLocalMode() && isExposedDeploy()) {
    throw new Error(
      '[synek] SYNEK_LOCAL_MODE is set on an exposed deploy (NODE_ENV=production or a ' +
        'non-localhost BETTER_AUTH_URL). It skips the login wall and signs every visitor in ' +
        'as the one shared local user — a total per-user-isolation bypass. Unset SYNEK_LOCAL_MODE ' +
        'on any hosted/multi-tenant deploy. Refusing to boot.',
    )
  }
}

assertLocalModeNotExposed()

// Optional Google sign-in. Key-gated exactly like the rest of the app: set BOTH
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and a "Continue with Google" button
// appears on the auth screen; leave either blank and the social path is entirely
// off — email/password only, so the local-first default is untouched. Google's
// OAuth redirect returns to `${BASE_URL}/api/auth/callback/google`, which the
// `/api/auth/$` catch-all already serves; register that exact URI as an authorized
// redirect in the Google Cloud OAuth client. No migration: the `account` table
// already carries the accessToken/refreshToken/idToken/scope columns social needs.
function resolveGoogleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

const googleCredentials = resolveGoogleCredentials()

// Client-visible feature flag (NEVER exposes the secret) — the auth screen reads
// this via the getAuthConfig server fn to decide whether to render the Google button.
export function googleAuthEnabled(): boolean {
  return googleCredentials !== null
}

export const auth = betterAuth({
  baseURL: BASE_URL,
  trustedOrigins: resolveTrustedOrigins(),
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
  session: { expiresIn: SESSION_EXPIRES_IN, updateAge: SESSION_UPDATE_AGE },
  // Google is added only when its credentials are present (see resolveGoogleCredentials).
  // Account linking is left at Better Auth's SECURE defaults (requireLocalEmailVerified:
  // true): a Google sign-in creates a new user, or links to an existing account whose
  // email is already verified — and REFUSES to link to an unverified email/password
  // account. That refusal is deliberate: signup here doesn't require verification, so
  // auto-linking to unverified locals would be a pre-account-hijack vector. `prompt:
  // 'select_account'` lets returning users pick which Google account to use.
  ...(googleCredentials
    ? {
        socialProviders: {
          google: {
            clientId: googleCredentials.clientId,
            clientSecret: googleCredentials.clientSecret,
            prompt: 'select_account',
          },
        },
      }
    : {}),
  plugins: [
    bearer(),
    // OAuth front door for MCP clients. `loginPage` is where an unauthenticated
    // user is sent to sign in (home shows the auth forms when logged out); after
    // that the plugin's built-in consent screen handles the "Authorize" click.
    mcp({ loginPage: '/', resource: MCP_RESOURCE }),
  ],
})
