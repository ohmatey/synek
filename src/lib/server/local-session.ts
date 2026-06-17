import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { auth } from '~/lib/auth'
import { isLocalMode, LOCAL_USER_EMAIL, LOCAL_USER_PASSWORD, LOCAL_USER_NAME } from '~/lib/auth/local-mode'

// In local mode, make sure a real Better Auth session exists for the local user and
// forward its Set-Cookie onto the current response. Wired into the root route's SSR
// beforeLoad, so the very first document carries the session cookie → no login wall,
// no flash, and every useSession() / owner-scoped read works normally thereafter.
//
// Hard no-op (returns immediately, sets no cookie, signs no one in) when
// SYNEK_LOCAL_MODE is unset — i.e. on every cloud deploy. See local-mode.ts.
export const ensureLocalSession = createServerFn({ method: 'GET' }).handler(async () => {
  if (!isLocalMode()) return { localMode: false as const }

  const headers = getRequestHeaders() as unknown as Headers
  const existing = await auth.api.getSession({ headers })
  if (existing?.user) return { localMode: true as const }

  // First run on a fresh DB: create the local user (idempotent), then sign in.
  try {
    await auth.api.signUpEmail({
      body: { email: LOCAL_USER_EMAIL, password: LOCAL_USER_PASSWORD, name: LOCAL_USER_NAME },
    })
  } catch {
    // user already exists — fine
  }

  const { headers: out } = await auth.api.signInEmail({
    body: { email: LOCAL_USER_EMAIL, password: LOCAL_USER_PASSWORD },
    returnHeaders: true,
  })
  const cookie = out.get('set-cookie')
  if (cookie) setResponseHeader('set-cookie', cookie)
  return { localMode: true as const }
})
