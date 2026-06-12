import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useSession } from '~/lib/auth/client'
import { capture, identifyUser, initPostHog, resetUser } from '~/lib/posthog/client'

// Read the current path safely (this only runs in a client-only effect anyway).
const currentPath = () => (typeof window === 'undefined' ? '/' : window.location.pathname)

// Client-only analytics bootstrap — a render-null sibling of ThemeSync, mounted
// inside <ClientOnly> in __root.tsx (never wrap <Outlet>, that would force the
// whole tree client-only and break SSR). It:
//   1. inits the browser client (no-op without a key / when opted out),
//   2. captures one $pageview per SPA navigation (capture_pageview is off, so this
//      is the single source — no double counting),
//   3. identifies the signed-in Better Auth user so client events join the same
//      PostHog person as the server-side MCP events (both keyed on the user id).
export function Analytics() {
  const router = useRouter()
  const { data: session } = useSession()

  useEffect(() => {
    initPostHog()
    // The first route resolves before this subscription mounts, so capture the
    // landing pageview here; subsequent SPA navigations come from onResolved.
    capture('$pageview', { path: currentPath() })
  }, [])

  useEffect(() => {
    const unsub = router.subscribe('onResolved', ({ toLocation }) => {
      capture('$pageview', { path: toLocation.pathname })
    })
    return unsub
  }, [router])

  useEffect(() => {
    const user = session?.user
    if (user?.id) identifyUser(user.id, user.email)
    else resetUser()
  }, [session?.user?.id, session?.user?.email])

  return null
}
