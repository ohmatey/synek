import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from './index'

// Server-side session access for TanStack server functions. Reads the incoming
// request headers (cookie/bearer) and validates them through Better Auth.

export type SessionUser = { id: string; email: string; name: string }

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() as unknown as Headers })
  if (!session?.user) return null
  const { id, email, name } = session.user
  return { id, email, name }
}

// Throw when there is no authenticated user — gates the API-key RPCs server-side
// so hiding the UI isn't the only protection.
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('unauthorized: sign in to manage API keys')
  return user
}
