import { createServerFn } from '@tanstack/react-start'
import { googleAuthEnabled } from '~/lib/auth'

// Public auth capabilities for the browser. Read once by the auth screen to decide
// whether to render the "Continue with Google" button — the flag is derived from the
// server-only GOOGLE_CLIENT_ID/SECRET env (see googleAuthEnabled), so the secret
// never reaches the client. No auth required: this is safe to fetch while signed out.
export const getAuthConfig = createServerFn({ method: 'GET' }).handler(async () => {
  return { googleEnabled: googleAuthEnabled() }
})
