import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTheme } from '@synek/ui'
import { getPublicStory } from '~/lib/server/stories'
import { PublicStoryReader } from '~/components/public/PublicStoryReader'
import { resolveThemeVars } from '~/lib/theme/resolveTimelineTheme'

// The PUBLIC, no-auth shareable story page (/s/$slug). SSR-loaded so the OpenGraph
// tags below carry the story into link unfurls (ads, email, social) and crawlers,
// and the cover renders without JS; the reels reader + widgets hydrate on the
// client. Visibility is enforced server-side in getPublicStory (timeline must be
// public) — a private or missing story returns null and renders a clean not-found.
export const Route = createFileRoute('/s/$slug')({
  loader: async ({ params }) => getPublicStory({ data: params.slug }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: 'Story not found · Synek' }] }
    }
    const { story, timelineTitle } = loaderData
    const desc = story.hook ?? `A live, sourced story on ${timelineTitle}.`
    const img = story.coverImage?.url
    return {
      meta: [
        { title: `${story.title} · Synek` },
        { name: 'description', content: desc },
        { property: 'og:type', content: 'article' },
        { property: 'og:site_name', content: 'Synek' },
        { property: 'og:title', content: story.title },
        { property: 'og:description', content: desc },
        ...(img ? [{ property: 'og:image', content: img }] : []),
        { name: 'twitter:card', content: img ? 'summary_large_image' : 'summary' },
        { name: 'twitter:title', content: story.title },
        { name: 'twitter:description', content: desc },
        ...(img ? [{ name: 'twitter:image', content: img }] : []),
      ],
    }
  },
  component: PublicStoryPage,
})

function PublicStoryPage() {
  const data = Route.useLoaderData()
  const { resolvedTheme } = useTheme()
  // The timeline's own theme as inline CSS vars (a branded artifact), computed at
  // runtime for the active scheme — same recipe the canvas uses.
  const themeVars = useMemo(
    () => (data ? resolveThemeVars(data.theme, resolvedTheme) : {}),
    [data, resolvedTheme],
  )

  if (!data) {
    return (
      <div className="public-story-missing">
        <h1>This story isn’t available</h1>
        <p>It may be private, or the link may be wrong.</p>
        <Link to="/" className="psr-cta">
          Explore Synek
        </Link>
      </div>
    )
  }

  return (
    <div className="public-story" style={themeVars} data-theme-scoped={data.theme ? '' : undefined}>
      <PublicStoryReader data={data} />
    </div>
  )
}
