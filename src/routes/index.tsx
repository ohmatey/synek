import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '@synek/ui'
import { Skeleton } from '~/components/ui/skeleton'
import { getAuthState } from '~/lib/server/auth-state'
import { AppHeader, Landing, SignedIn } from '~/components/home'

const TITLE = 'Synek — A timeline canvas your AI builds for you'
const DESCRIPTION =
  'Synek is a local-first, MCP-native timeline canvas. Connect your MCP client (Claude Desktop, Claude Code) and it weaves a living, time-anchored mesh of events, people and ideas — the app holds no model of its own.'

export const Route = createFileRoute('/')({
  // Resolve the session on the server so the marketing landing is server-rendered
  // for crawlers (and a signed-in user gets the dashboard) — no client spinner,
  // no logged-in/out flash.
  loader: () => getAuthState(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Synek' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'theme-color', content: '#08090c' },
    ],
  }),
  component: Home,
})

// Shown only to a signed-in user while the (client-only) dashboard hydrates —
// the public landing never sees this; it's fully server-rendered.
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

function Home() {
  const { user } = Route.useLoaderData()
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main className="flex-1">
        {user ? (
          <ClientOnly fallback={<DashboardSkeleton />}>
            <SignedIn />
          </ClientOnly>
        ) : (
          <Landing />
        )}
      </main>
    </div>
  )
}
