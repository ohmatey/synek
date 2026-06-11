import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useThemeContext } from '@synek/ui'
import { useSession } from '~/lib/auth/client'
import { getUserTheme } from '~/lib/server/preferences'

// Reconciles the per-user theme (stored on the user row) with the device-local
// ThemeProvider. When a signed-in session resolves, we fetch the saved theme and
// apply it via setTheme — which also rewrites the cookie, so subsequent loads
// pick it up pre-hydration with no flash. Render behind <ClientOnly>: useSession
// is client-only and the fetch must not run during SSR.
export function ThemeSync() {
  const { data: session } = useSession()
  const { theme, setTheme } = useThemeContext()

  const { data } = useQuery({
    queryKey: ['user-theme'],
    queryFn: () => getUserTheme(),
    enabled: !!session?.user,
    staleTime: Infinity,
  })
  const serverTheme = data?.theme

  // Apply only when the server value itself changes, so a local pick (which also
  // persists to the server) never gets fought or reverted.
  useEffect(() => {
    if (serverTheme && serverTheme !== theme) setTheme(serverTheme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTheme])

  return null
}
