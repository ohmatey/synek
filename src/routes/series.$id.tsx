import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { BookOpenText, ChevronRight, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '@synek/ui'
import { getSeriesDetail } from '~/lib/server/series'
import { applyBrandToSeries } from '~/lib/server/brands'
import { BrandPicker } from '~/components/brand/BrandPicker'
import { AppHeader } from '~/components/home/AppHeader'
import { SeriesJacket } from '~/components/public/SeriesJacket'
import { SeriesSpine, type SpineChapter } from '~/components/public/SeriesSpine'
import { ShareSeriesButton } from '~/components/public/ShareSeriesButton'
import { PromptDialog, type PromptSpec } from '~/components/PromptDialog'
import { Button } from '~/components/ui/button'
import { buildNextChapterPrompt } from '~/lib/story-prompt'
import { resolveThemeVars } from '~/lib/theme/resolveTimelineTheme'
import { formatInstant } from '~/lib/domain/dates'

// The in-app SERIES DETAIL — the creator's workspace for one serialized "book"
// (local-161 slice B). Owner-only: getSeriesDetail returns null for anonymous or
// foreign viewers, and the page renders a clean "not available" state. Reuses the
// shared evolving-book language (SeriesJacket + SeriesSpine) with creator controls:
// the frontier, the "Write the next chapter" CTA (the PromptDialog inversion seam),
// and Share (publishes the season). Per-chapter publish is deliberately out of v1 —
// the season-level Share ships every chapter (ADR 0006 D10).
export const Route = createFileRoute('/series/$id')({
  loader: async ({ params }) => getSeriesDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.series.title} · Synek` : 'Series · Synek' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: SeriesDetailPage,
})

function SeriesDetailPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const [promptOpen, setPromptOpen] = useState(false)
  const [brandId, setBrandId] = useState<string | null>(data?.series.brandId ?? null)

  const applyBrand = async (id: string | null) => {
    if (!data) return
    setBrandId(id)
    const res = await applyBrandToSeries({ data: { seriesId: data.series.id, brandId: id } })
    if ('error' in res) {
      toast.error('Couldn’t apply the brand')
      return
    }
    toast.success(id ? 'Brand applied — series theme seeded' : 'Brand cleared')
    void router.invalidate()
  }

  const themeVars = useMemo(
    () => (data ? resolveThemeVars(data.series.theme, resolvedTheme) : {}),
    [data, resolvedTheme],
  )

  const nextChapterSpec = useMemo<PromptSpec | null>(() => {
    if (!data) return null
    return {
      title: 'Write the next chapter',
      description: `Hand this to your connected Claude — it reads “${data.series.title}” so far and writes the next chapter onto your timeline.`,
      params: [
        { label: 'Series', value: data.series.title },
        { label: 'Chapters', value: String(data.chapters.length) },
      ],
      prompt: buildNextChapterPrompt({
        seriesId: data.series.id,
        seriesTitle: data.series.title,
        chapterCount: data.chapters.length,
      }),
      analytics: { event: 'story_prompt_copied', props: { mode: 'next_chapter', series_id: data.series.id } },
    }
  }, [data])

  if (!data) {
    return (
      <>
        <AppHeader />
        <main className="sd-missing">
          <div className="psm-card">
            <BookOpenText className="psm-icon" aria-hidden />
            <h1>This series isn’t available</h1>
            <p>It may be private, moved, or you may need to sign in to view it.</p>
            <Link to="/" className="psr-cta">
              Go to your workspace
            </Link>
          </div>
        </main>
      </>
    )
  }

  const { series, chapters, frontier } = data
  const spineChapters: SpineChapter[] = chapters.map((c) => ({
    number: c.number,
    title: c.title,
    hook: c.hook,
    momentInstant: c.momentInstant,
    status: c.status === 'published' ? 'published' : 'draft',
  }))

  const frontierText =
    frontier.lastChapterNumber == null
      ? 'No chapters yet — start with Chapter I.'
      : `Frontier: Chapter ${frontier.lastChapterNumber}` +
        (frontier.lastInstant != null ? ` · up to ${formatInstant(frontier.lastInstant, 'year')}` : '')

  return (
    <>
      <AppHeader />
      <main className="sd-page" style={themeVars} data-theme-scoped={series.theme ? '' : undefined}>
        <nav className="sd-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Workspace</Link>
          <ChevronRight size={14} aria-hidden />
          <span aria-current="page">{series.title}</span>
        </nav>

        <SeriesJacket
          title={series.title}
          hook={series.hook}
          coverImage={series.coverImage}
          chapterCount={chapters.length}
          updatedAt={data.updatedAt}
          actions={
            <ShareSeriesButton
              seriesId={series.id}
              shared={series.isPublic}
              label={series.isPublic ? 'Copy this series’ public link' : 'Share series publicly'}
              className="sd-share"
            />
          }
        />

        <section className="sd-frontier" aria-label="Series status">
          <p className="sd-frontier-text">{frontierText}</p>
          <div className="sd-actions">
            <Button type="button" onClick={() => setPromptOpen(true)} className="sd-write">
              <PenLine aria-hidden />
              Write the next chapter
            </Button>
            <span className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Brand</span>
              <BrandPicker value={brandId} onChange={(id) => void applyBrand(id)} />
            </span>
            {series.isPublic && (
              <a className="sd-open-season" href={`/sr/${series.slug}`} target="_blank" rel="noreferrer">
                Open public season ↗
              </a>
            )}
          </div>
        </section>

        {chapters.length > 0 ? (
          <SeriesSpine chapters={spineChapters} updatedAt={data.updatedAt} numerals="arabic" />
        ) : (
          <p className="sd-empty">Your book is empty. Write Chapter I to set the world in motion.</p>
        )}
      </main>

      <PromptDialog open={promptOpen} onOpenChange={setPromptOpen} spec={nextChapterSpec} />
    </>
  )
}
