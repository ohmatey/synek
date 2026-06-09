import { createServerFn } from '@tanstack/react-start'
import { getCurrentUser } from '~/lib/auth/session'

// SSR-friendly auth read for the home route loader: resolves the session on the
// server (from the request cookie) so the marketing page renders server-side for
// crawlers and there's no logged-in/out flash. Never throws — a failure resolves
// to "logged out" so the (public) landing still renders.
export const getAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const user = await getCurrentUser()
    return { user: user ? { name: user.name, email: user.email } : null }
  } catch {
    return { user: null }
  }
})
