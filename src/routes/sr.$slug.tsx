import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BookOpenText, List, Sparkles, X } from 'lucide-react'
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
  // Bumped on every chapter pick — drives the reader to begin playback (the single
  // start path; the reader's own cover CTA is suppressed in series mode).
  const [startNonce, setStartNonce] = useState(0)
  // Mobile: the spine is an overlay sheet (desktop pins it as a sidebar instead).
  const [sheetOpen, setSheetOpen] = useState(false)
  const readerRef = useRef<HTMLDivElement>(null)
  const sheetToggleRef = useRef<HTMLButtonElement>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)

  // Sheet a11y: Esc closes it and focus returns to the toggle; opening moves focus
  // to the close button so keyboard users land inside the panel.
  useEffect(() => {
    if (!sheetOpen) return
    sheetCloseRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheetOpen(false)
        sheetToggleRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  // Pick a chapter: swap the reader to it, start playback, close the mobile sheet,
  // and pull the reader into view (no-op on desktop where it's already pinned).
  const selectChapter = useCallback((i: number) => {
    setIndex(i)
    setStartNonce((n) => n + 1)
    setSheetOpen(false)
    readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

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

  return (
    <div className="public-story public-series" style={themeVars} data-theme-scoped={series.theme ? '' : undefined}>
      {/* Left rail (desktop sidebar / mobile top band): season identity + the single
          "Begin reading" CTA, with the spine pinned beneath it on desktop. */}
      <div className="ps-rail">
        <SeriesJacket
          title={series.title}
          hook={series.hook}
          coverImage={series.coverImage}
          chapterCount={chapters.length}
          updatedAt={updatedAt}
          onBegin={() => selectChapter(safeIndex)}
          beginLabel={safeIndex > 0 ? 'Continue reading' : 'Begin reading'}
          actions={
            <button
              ref={sheetToggleRef}
              type="button"
              className="ps-chapters-toggle"
              aria-expanded={sheetOpen}
              aria-controls="series-chapter-sheet"
              onClick={() => setSheetOpen((v) => !v)}
            >
              <List size={16} aria-hidden />
              Chapters ({chapters.length})
            </button>
          }
        />

        {/* One spine instance: a pinned list on desktop, a toggled overlay sheet on
            mobile (CSS-driven). A disclosure panel, not a modal — keeps a single
            "Table of contents" landmark and avoids SSR role-switching. */}
        <div id="series-chapter-sheet" className="ps-spine" data-open={sheetOpen ? '' : undefined}>
          <div className="ps-sheet-head" aria-hidden={!sheetOpen}>
            <span className="ps-sheet-title">Chapters</span>
            <button
              ref={sheetCloseRef}
              type="button"
              className="ps-sheet-close"
              onClick={() => {
                setSheetOpen(false)
                sheetToggleRef.current?.focus()
              }}
              aria-label="Close chapter list"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <SeriesSpine chapters={spineChapters} activeIndex={safeIndex} onSelect={selectChapter} updatedAt={updatedAt} />
        </div>
      </div>

      {sheetOpen && (
        <button
          type="button"
          className="ps-sheet-backdrop"
          aria-label="Close chapter list"
          onClick={() => setSheetOpen(false)}
        />
      )}

      <div ref={readerRef} className="public-series-reader">
        <PublicStoryReader
          key={current.story.id}
          data={chapterDTO}
          hasNext={hasNext}
          onNext={() => setIndex((i) => i + 1)}
          chapterMeta={{ number: current.chapterNumber, seriesTitle: series.title }}
          startSignal={startNonce}
          hideCoverCta
          nextChapterTitle={chapters[safeIndex + 1]?.story.title}
        />
      </div>
    </div>
  )
}
