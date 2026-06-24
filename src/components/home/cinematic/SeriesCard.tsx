import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BookOpen, Layers, Play, PenLine } from 'lucide-react'
import type { HomeSeriesCard } from '~/lib/domain/types'
import { ShareSeriesButton } from '~/components/public/ShareSeriesButton'
import { PromptDialog, type PromptSpec } from '~/components/PromptDialog'
import { buildNextChapterPrompt } from '~/lib/story-prompt'
import { hueFromString } from './hue'

const ICON_BTN =
  'grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60'

// One series in the home "Series" row (ADR 0006 slice 5) — a poster for a whole
// serialized season. When the series is public the card opens its /sr/$slug season
// page; when it's still a draft the cover is inert and the foot offers the Share
// control to publish. Mirrors StoryCard's .ch-card shell.
export function SeriesCard({ series }: { series: HomeSeriesCard }) {
  const href = `/sr/${series.slug}`
  const [promptOpen, setPromptOpen] = useState(false)

  // The headline action: hand the connected Claude a ready-made prompt to write the
  // next chapter onto this series (copy-only — Run needs a per-series timeline, a
  // follow-up). Reuses the shared PromptDialog/PromptActions inversion seam.
  const nextChapterSpec = useMemo<PromptSpec>(
    () => ({
      title: 'Write the next chapter',
      description: `Hand this to your connected Claude — it reads “${series.title}” so far and writes the next chapter onto your timeline.`,
      params: [
        { label: 'Series', value: series.title },
        { label: 'Chapters', value: String(series.chapterCount) },
      ],
      prompt: buildNextChapterPrompt({
        seriesId: series.seriesId,
        seriesTitle: series.title,
        chapterCount: series.chapterCount,
      }),
      analytics: { event: 'story_prompt_copied', props: { mode: 'next_chapter', series_id: series.seriesId } },
    }),
    [series.seriesId, series.title, series.chapterCount],
  )
  const cover = (
    <>
      <span
        className="ch-card-cover"
        data-wash={series.coverImage ? undefined : true}
        style={series.coverImage ? undefined : ({ '--cover-hue': hueFromString(series.seriesId) } as React.CSSProperties)}
      >
        {series.coverImage ? (
          <img src={series.coverImage.url} alt={series.coverImage.alt ?? ''} loading="lazy" />
        ) : (
          <span className="ch-card-cover-fallback" aria-hidden="true">
            <Layers />
          </span>
        )}
      </span>
      <span className="ch-card-body">
        <span className="ch-card-title">{series.title}</span>
        {series.hook && <span className="ch-card-hook">{series.hook}</span>}
        <span className="ch-card-meta">
          <span>
            {series.chapterCount} {series.chapterCount === 1 ? 'chapter' : 'chapters'}
          </span>
        </span>
      </span>
    </>
  )

  return (
    <article className="ch-card">
      {series.isPublic ? (
        <a className="ch-card-open" href={href} aria-label={`Open “${series.title}” season`}>
          {cover}
        </a>
      ) : (
        <div className="ch-card-open" aria-label={series.title}>
          {cover}
        </div>
      )}
      <div className="ch-card-foot">
        {series.isPublic ? (
          <a className="ch-card-play" href={href}>
            <Play aria-hidden="true" />
            Open season
          </a>
        ) : (
          // A draft has no public reader yet — publishing IS the next step. Lead with
          // it: a text+icon button on the amber story accent (carrier, not a passive
          // "Draft" label). Reuses the ShareSeriesButton publish flow.
          <ShareSeriesButton
            seriesId={series.seriesId}
            shared={false}
            variant="prominent"
            label={`Publish “${series.title}” to share`}
          />
        )}
        <span className="flex items-center gap-1">
          <Link
            to="/series/$id"
            params={{ id: series.seriesId }}
            className={ICON_BTN}
            aria-label={`View “${series.title}” in your workspace`}
            title="View series"
          >
            <BookOpen aria-hidden="true" className="size-4" />
          </Link>
          <button
            type="button"
            className={ICON_BTN}
            onClick={() => setPromptOpen(true)}
            aria-label={`Write the next chapter of “${series.title}”`}
            title="Write the next chapter"
          >
            <PenLine aria-hidden="true" className="size-4" />
          </button>
          {/* Public series keep the compact copy-link control; drafts publish via the
              prominent button above, so the redundant icon is omitted there. */}
          {series.isPublic && (
            <ShareSeriesButton seriesId={series.seriesId} shared className={ICON_BTN} />
          )}
        </span>
      </div>
      <PromptDialog open={promptOpen} onOpenChange={setPromptOpen} spec={nextChapterSpec} />
    </article>
  )
}
