import { createFileRoute } from '@tanstack/react-router'
import { AppHeader } from '~/components/home'
import { ExplorePage } from '~/components/explore'

const TITLE = 'Synek — explore public stories, timelines and ideas'
const DESCRIPTION =
  'A living, time-anchored mesh of events, people and ideas, built by people connecting their AI to Synek. Explore public stories and timelines, then make your own.'

// The root `/` is the public Explore feed — a cross-user discovery surface shown
// to everyone (it replaced the marketing landing). Signing in doesn't change the
// content; it adds the Projects button in the header (→ /projects), which is the
// signed-in workspace. The per-project filter / dashboard moved to /projects.
export const Route = createFileRoute('/')({
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

function Home() {
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main className="flex-1">
        <ExplorePage />
      </main>
    </div>
  )
}
