import { useEffect, useState } from 'react'
import { cn } from '~/lib/utils'
import { formatInstant } from '~/lib/domain/dates'
import { toRomanNumeral } from '~/lib/roman-numeral'
import { timeAgo } from '~/lib/time-ago'

export type SpineChapter = {
  number: number | null
  title: string
  hook: string | null
  // Earliest covered instant — the chapter's dateline (right column). null = undated.
  momentInstant: number | null
  // Editor surface only: draft chapters render dimmed with a status pill.
  status?: 'draft' | 'published'
}

// The book's spine / table of contents — an ordered vertical list whose visual weight
// GROWS as chapters accumulate (the "evolving book" promise made legible). Replaces
// the old horizontal chip rail, which overflowed off-screen past a few chapters.
// Shared shell for both surfaces: public passes onSelect (interactive, Roman
// numerals) and the latest chapter is flagged "New"; the in-app editor passes
// per-chapter status and Arabic numerals.
export function SeriesSpine({
  chapters,
  activeIndex,
  onSelect,
  updatedAt,
  numerals = 'roman',
}: {
  chapters: SpineChapter[]
  activeIndex?: number
  // Interactive when provided (renders a <button>); otherwise static rows.
  onSelect?: (index: number) => void
  updatedAt: number
  numerals?: 'roman' | 'arabic'
}) {
  // Client-only relative time on the latest chapter (avoids SSR hydration drift).
  const [rel, setRel] = useState<string | null>(null)
  useEffect(() => {
    setRel(timeAgo(updatedAt))
  }, [updatedAt])

  const latestIndex = chapters.length - 1

  return (
    <nav className="sb-spine" aria-label="Table of contents">
      <ol className="sb-list">
        {chapters.map((ch, i) => {
          const num = ch.number ?? i + 1
          const numeral = numerals === 'roman' ? toRomanNumeral(num) : String(num)
          const isLatest = i === latestIndex && chapters.length > 1
          const isActive = i === activeIndex
          const dateline = ch.momentInstant != null ? formatInstant(ch.momentInstant, 'year') : null
          const statusText = ch.status ? (ch.status === 'draft' ? 'draft' : 'published') : null
          const ariaLabel = `Chapter ${num}: ${ch.title}${statusText ? `, ${statusText}` : ''}${isLatest ? ', latest' : ''}`

          const inner = (
            <>
              <span className="sb-num" aria-hidden="true">
                {numeral}
              </span>
              <span className="sb-main">
                <span className="sb-title-row">
                  <span className="sb-title">{ch.title}</span>
                  {isLatest && (
                    <span className="sb-new">
                      New{rel ? ` · ${rel}` : ''}
                      <span className="sr-only">{rel ? `, added ${rel}` : ', latest chapter'}</span>
                    </span>
                  )}
                  {ch.status === 'draft' && <span className="sb-status sb-status-draft">Draft</span>}
                </span>
                {ch.hook && <span className="sb-hook">{ch.hook}</span>}
              </span>
              {dateline && (
                <span className="sb-dateline" aria-hidden="true">
                  {dateline}
                </span>
              )}
            </>
          )

          return (
            <li key={i} className={cn('sb-row', ch.status === 'draft' && 'is-draft', isActive && 'is-active')}>
              {onSelect ? (
                <button
                  type="button"
                  className="sb-row-btn"
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={ariaLabel}
                  onClick={() => onSelect(i)}
                >
                  {inner}
                </button>
              ) : (
                <div className="sb-row-static" aria-label={ariaLabel}>
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
