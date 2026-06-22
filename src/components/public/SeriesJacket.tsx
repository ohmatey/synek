import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import type { StoryImage } from '~/lib/domain/types'
import { timeAgo } from '~/lib/time-ago'

// The book jacket — the series' front face, shared by the public season page and the
// in-app series detail (local-161/162). A large cover with the series title in the
// theme DISPLAY FONT, the hook as a tagline, a "Season · N chapters · updated X ago"
// meta line that makes growth legible, and a primary CTA. Presentational: it reads
// only props (no server data, no auth), so the in-app detail can import it freely.
// The display font + accents come from the inherited theme vars on the page root.
export function SeriesJacket({
  title,
  hook,
  coverImage,
  chapterCount,
  updatedAt,
  onBegin,
  beginLabel = 'Begin reading',
  actions,
}: {
  title: string
  hook: string | null
  coverImage: StoryImage | null
  chapterCount: number
  updatedAt: number
  // Optional — the public page scrolls to the reader; the in-app hero may omit it.
  onBegin?: () => void
  beginLabel?: string
  // Owner controls (status badge, Share) rendered in the in-app hero.
  actions?: ReactNode
}) {
  // Relative time is client-only (timeAgo reads Date.now()); render the count alone
  // on the server, append "· updated X ago" after mount to avoid a hydration drift.
  const [rel, setRel] = useState<string | null>(null)
  useEffect(() => {
    setRel(timeAgo(updatedAt))
  }, [updatedAt])

  const meta =
    `Season · ${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'}` + (rel ? ` · updated ${rel}` : '')

  return (
    <section className="sj-jacket" data-has-cover={coverImage ? '' : undefined} aria-label={`${title} — season cover`}>
      {coverImage ? (
        <div className="sj-cover" aria-hidden="true">
          <img src={coverImage.url} alt={coverImage.alt ?? ''} />
        </div>
      ) : (
        <div className="sj-cover sj-cover-fallback" aria-hidden="true">
          <BookOpen />
        </div>
      )}
      <div className="sj-body">
        <h1 className="sj-title">{title}</h1>
        {hook && <p className="sj-hook">{hook}</p>}
        <p className="sj-meta">{meta}</p>
        {(onBegin || actions) && (
          <div className="sj-actions">
            {onBegin && (
              <button type="button" className="sj-begin" onClick={onBegin}>
                <BookOpen size={16} aria-hidden />
                {beginLabel}
              </button>
            )}
            {actions}
          </div>
        )}
      </div>
    </section>
  )
}
