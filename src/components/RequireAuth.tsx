import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Skeleton } from '~/components/ui/skeleton'
import { useSession } from '~/lib/auth/client'

// Client-side auth gate for the settings pages. useSession resolves to null on
// the server (and the first client render), so callers must render this behind
// <ClientOnly> — otherwise a fresh load would flash the redirect. A signed-out
// visitor is bounced to /login; while resolving we hold a skeleton.
export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { data: session, isPending } = useSession()

  useEffect(() => {
    if (!isPending && !session?.user) void navigate({ to: '/login', replace: true })
  }, [isPending, session, navigate])

  if (isPending) return <Skeleton className="h-72 w-full rounded-xl border border-border/60" />
  if (!session?.user) return null
  return <>{children}</>
}
