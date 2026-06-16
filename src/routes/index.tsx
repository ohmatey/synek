import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useSession } from '~/lib/auth/client'
import { AppHeader, Landing, SignedIn } from '~/components/home'

const TITLE = 'Synek — A timeline canvas your AI builds for you'
const DESCRIPTION =
  'Synek is a local-first, MCP-native timeline canvas. Connect your MCP client (Claude Desktop, Claude Code) and it weaves a living, time-anchored mesh of events, people and ideas — the app holds no model of its own.'

// The cinematic home's page-level filter: `?project=<slug>` re-scopes the hero +
// rows to one project (Wren §3/§11, PRD US3). Deep-linkable + back-safe; the
// `/p/$slug` route resolves a project handle onto it. Optional + `.catch` for a
// SOFT fallback — an unknown/foreign/garbage slug degrades to "All" (the absent-
// param view), never a 404 (PRD US3 acceptance). Ownership is resolved client-
// side against the user's own projects, so a foreign slug simply matches nothing.
const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
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

// The marketing landing is the server-rendered default — useSession resolves to
// null on the server (and on the first client render of a fresh load), so the
// landing renders synchronously in the SSR shell: crawlable, no spinner, no
// streaming race. Once the client confirms a session it swaps to the dashboard.
//
// Signed IN, the dashboard is a full app shell (its own left sidebar carries the
// logo + account), so the marketing AppHeader is signed-OUT only — no top bar
// floating above the sidebar.
function HomeBody() {
  const { data: session } = useSession()
  if (session?.user) return <SignedIn />
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <Landing />
      </main>
    </>
  )
}

function Home() {
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <HomeBody />
    </div>
  )
}
