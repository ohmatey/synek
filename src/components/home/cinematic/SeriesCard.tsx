import { Layers, Play } from 'lucide-react'
import type { HomeSeriesCard } from '~/lib/domain/types'
import { ShareSeriesButton } from '~/components/public/ShareSeriesButton'
import { hueFromString } from './hue'

// One series in the home "Series" row (ADR 0006 slice 5) — a poster for a whole
// serialized season. When the series is public the card opens its /sr/$slug season
// page; when it's still a draft the cover is inert and the foot offers the Share
// control to publish. Mirrors StoryCard's .ch-card shell.
export function SeriesCard({ series }: { series: HomeSeriesCard }) {
  const href = `/sr/${series.slug}`
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
          <span className="px-2 text-xs font-medium text-muted-foreground">Draft</span>
        )}
        <ShareSeriesButton
          seriesId={series.seriesId}
          shared={series.isPublic}
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>
    </article>
  )
}
