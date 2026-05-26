import { createAuthClient } from 'better-auth/react'

// Browser-side Better Auth client. baseURL is inferred from window.location at
// call time, and requests hit the catch-all handler at /api/auth/*. Used by the
// home auth panel for email/password sign-up, sign-in, sign-out, and useSession.
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
