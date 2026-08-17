import { ExternalLink } from 'lucide-react'
import { cn } from '~/lib/utils'
import {
  RELIABILITY_LABEL,
  SOURCE_TYPE_LABEL,
  UNTITLED_SOURCE,
  citationHref,
  displayUrl,
} from '~/lib/domain/citations'
import type { StoryBeatCitation } from '~/lib/domain/types'

// ONE citation card, used by the node panel, the in-app story reader, and the
// public story reader.
//
// It replaces three unrelated markup families (`detail-cite-*`, `sv-cite-*`,
// `psr-cite-*`) that rendered the same data three different ways, with three
// different fallback labels, and in the public reader's case dropped half of it.
// Anatomy, top to bottom:
//
//   [Primary]  ← sourceType badge, the field that was plumbed everywhere and drawn nowhere
//   Title of the source ↗          ← the ONE link (the panel used to emit two to the same href)
//   host.example.com/path          ← plain text, not a second link
//   “the quoted line”
//   ▸ View artifact                ← only when an artifact backs it
//
// `dense` tightens it for the story readers, where citations sit under a beat and
// must not outweigh the prose. It is the same card, not a different design.
export function CitationCard({
  citation,
  dense = false,
  className,
}: {
  citation: StoryBeatCitation
  dense?: boolean
  className?: string
}) {
  const href = citationHref(citation.url)
  const host = displayUrl(citation.url)
  const title = citation.title?.trim() || UNTITLED_SOURCE
  const hasArtifact = !!(citation.transcript || citation.translation || citation.imageUrl)

  return (
    <div className={cn('cite-card', dense && 'is-dense', className)}>
      {(citation.sourceType || citation.reliability) && (
        <div className="cite-badges">
          {citation.sourceType && (
            <span className={cn('cite-badge', `is-${citation.sourceType}`)}>
              {SOURCE_TYPE_LABEL[citation.sourceType]}
            </span>
          )}
          {citation.reliability && (
            <span className={cn('cite-badge is-reliability', `is-rel-${citation.reliability}`)}>
              {RELIABILITY_LABEL[citation.reliability] ?? citation.reliability}
            </span>
          )}
        </div>
      )}

      {href ? (
        <a
          className="cite-title is-link"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          // The visible text is the source name, so an SR link list would otherwise
          // read "Open source" N times. Name the link by what it opens.
          aria-label={`${title} (opens in a new tab)`}
        >
          <span className="cite-title-text">{title}</span>
          <ExternalLink className="cite-title-icon" aria-hidden="true" />
        </a>
      ) : (
        <span className="cite-title">{title}</span>
      )}

      {host && <span className="cite-host">{host}</span>}

      {citation.quote?.trim() && <p className="cite-quote">{citation.quote.trim()}</p>}

      {hasArtifact && (
        <details className="cite-artifact">
          <summary>View artifact</summary>
          {citation.imageUrl && <img className="cite-artifact-img" src={citation.imageUrl} alt="" loading="lazy" />}
          {citation.transcript && <p className="cite-artifact-text">{citation.transcript}</p>}
          {citation.translation && <p className="cite-artifact-text is-translation">{citation.translation}</p>}
        </details>
      )}
    </div>
  )
}

// The list wrapper. Kept beside the card so the gap rhythm is defined once.
export function CitationList({
  citations,
  dense = false,
  className,
  id,
}: {
  citations: StoryBeatCitation[]
  dense?: boolean
  className?: string
  // Set when a collapsible header points at this list via aria-controls.
  id?: string
}) {
  if (citations.length === 0) return null
  return (
    <ul id={id} className={cn('cite-list', dense && 'is-dense', className)}>
      {citations.map((c, i) => (
        <li key={i}>
          <CitationCard citation={c} dense={dense} />
        </li>
      ))}
    </ul>
  )
}
