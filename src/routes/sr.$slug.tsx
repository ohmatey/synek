import { useMemo, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BookOpenText, Sparkles } from 'lucide-react'
import { useTheme } from '@synek/ui'
import { getPublicSeries } from '~/lib/server/series'
import { PublicStoryReader } from '~/components/public/PublicStoryReader'
import { SeriesJacket } from '~/components/public/SeriesJacket'
import { SeriesSpine, type SpineChapter } from '~/components/public/SeriesSpine'
import { resolveThemeVars } from '~/lib/theme/resolveTimelineTheme'
import type { PublicStoryDTO } from '~/lib/domain/types'

// The PUBLIC, no-auth shareable SERIES page (/sr/$slug) — the "Netflix season"
// (ADR 0006 D10). SSR-loaded so the OpenGraph tags carry the season into link
// unfurls and crawlers. Visibility is enforced server-side in getPublicSeries (the
// SERIES must be public) — a private or missing series returns null indistinguishably
// and renders one clean "not available" page. Chapters play IN ORDER by driving the
// existing PublicStoryReader once per chapter, with "next chapter →" continuation;
// the chapter index is held here, outside the reader.
export const Route = createFileRoute('/sr/$slug')({
  loader: async ({ params }) => getPublicSeries({ data: params.slug }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: 'Series not found · Synek' }] }
    }
    const { series, chapters } = loaderData
    const desc = series.hook ?? `A serialized story in ${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'} on Synek.`
    const img = series.coverImage?.url
    return {
      meta: [
        { title: `${series.title} · Synek` },
        { name: 'description', content: desc },
        { property: 'og:type', content: 'article' },
        { property: 'og:site_name', content: 'Synek' },
        { property: 'og:title', content: series.title },
        { property: 'og:description', content: desc },
        ...(img ? [{ property: 'og:image', content: img }] : []),
        { name: 'twitter:card', content: img ? 'summary_large_image' : 'summary' },
        { name: 'twitter:title', content: series.title },
        { name: 'twitter:description', content: desc },
        ...(img ? [{ name: 'twitter:image', content: img }] : []),
      ],
    }
  },
  component: PublicSeriesPage,
})

function PublicSeriesPage() {
  const data = Route.useLoaderData()
  const { resolvedTheme } = useTheme()
  const themeVars = useMemo(
    () => (data ? resolveThemeVars(data.series.theme, resolvedTheme) : {}),
    [data, resolvedTheme],
  )
  const [index, setIndex] = useState(0)
  const readerRef = useRef<HTMLDivElement>(null)

  if (!data || data.chapters.length === 0) {
    return (
      <div className="public-story-missing">
        <div className="psm-card">
          <BookOpenText className="psm-icon" aria-hidden />
          <h1>This series isn’t available</h1>
          <p>
            The link may be private, moved, or mistyped. Ask whoever sent it to re-share, or start
            your own serialized story.
          </p>
          <Link to="/" className="psr-cta">
            <Sparkles size={16} aria-hidden />
            Make your own with Synek
          </Link>
        </div>
      </div>
    )
  }

  const { series, chapters, nodes, updatedAt } = data
  const safeIndex = Math.min(index, chapters.length - 1)
  const current = chapters[safeIndex]!
  const hasNext = safeIndex < chapters.length - 1

  // Drive the existing reader with a per-chapter DTO. The season title rides in as
  // the reader's "timeline" label; nodes are the series-wide union (the reader keys
  // widgets off ids). Keyed by story id so the reader resets cleanly per chapter.
  const chapterDTO: PublicStoryDTO = {
    story: current.story,
    timelineId: '',
    timelineTitle: series.title,
    theme: series.theme,
    viewSettings: null,
    updatedAt,
    nodes,
  }

  const spineChapters: SpineChapter[] = chapters.map((c) => ({
    number: c.chapterNumber,
    title: c.story.title,
    hook: c.story.hook,
    momentInstant: c.momentInstant,
  }))

  const selectChapter = (i: number) => {
    setIndex(i)
    readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="public-story public-series" style={themeVars} data-theme-scoped={series.theme ? '' : undefined}>
      <SeriesJacket
        title={series.title}
        hook={series.hook}
        coverImage={series.coverImage}
        chapterCount={chapters.length}
        updatedAt={updatedAt}
        onBegin={() => selectChapter(safeIndex)}
        beginLabel={safeIndex > 0 ? 'Continue reading' : 'Begin reading'}
      />
      <SeriesSpine chapters={spineChapters} activeIndex={safeIndex} onSelect={selectChapter} updatedAt={updatedAt} />
      <div ref={readerRef} className="public-series-reader">
        <PublicStoryReader
          key={current.story.id}
          data={chapterDTO}
          hasNext={hasNext}
          onNext={() => setIndex((i) => i + 1)}
          chapterMeta={{ number: current.chapterNumber, seriesTitle: series.title }}
          ctaLabel="Begin chapter"
          nextChapterTitle={chapters[safeIndex + 1]?.story.title}
        />
      </div>
    </div>
  )
}
