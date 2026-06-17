// Local single-user mode (SERVER-ONLY, OFF by default).
//
// When SYNEK_LOCAL_MODE is set, the app auto-signs-in the deterministic local user
// so there is no login wall — "the app trusts whoever runs it", the same single-user
// posture as token.ts. This is for `bun run dev` and self-hosted single-user
// instances: anyone downloads Synek, runs it locally, and is straight in.
//
// ⚠️ NEVER set SYNEK_LOCAL_MODE in a multi-tenant / cloud deploy. It bypasses the
// login screen and signs EVERY visitor in as the one shared local user. The flag is
// unset by default (so all cloud deploys keep real auth) and is intentionally absent
// from fly.toml. The gate is checked server-side only; with it unset, behaviour is
// identical to before this feature existed.

// The deterministic local identity (shared with token.ts so the auto-signed-in user
// is the same one `bun run issue:key` mints). Overridable for a custom local user.
export const LOCAL_USER_EMAIL = process.env.SYNEK_USER_EMAIL || 'local@synek.app'
export const LOCAL_USER_PASSWORD = process.env.SYNEK_USER_PASSWORD || 'synek-local-password-0000'
export const LOCAL_USER_NAME = 'Local'

export function isLocalMode(): boolean {
  const v = process.env.SYNEK_LOCAL_MODE?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
