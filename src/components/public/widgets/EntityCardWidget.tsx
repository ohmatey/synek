import { BookOpen, Box, Building2, Layers, Lightbulb, MapPin, User, Zap } from 'lucide-react'
import { cn } from '~/lib/utils'
import type { GraphNode } from '~/lib/domain/types'
import { formatInstantRange } from '~/lib/domain/dates'

// A read-only entity card — the `entity` beat widget. Standalone (no React Flow):
// a framed image (portrait/landscape) or a typed placeholder, the title, a
// dateline, an optional place, and a clamped summary. SSR-safe (pure markup).

function typeIcon(n: GraphNode) {
  if (n.type === 'period') return Layers
  if (n.type === 'concept') return Lightbulb
  if (n.type === 'event') return Zap
  switch (n.subtype) {
    case 'person':
      return User
    case 'org':
      return Building2
    case 'place':
      return MapPin
    case 'work':
      return BookOpen
    default:
      return Box
  }
}

function typeLabel(n: GraphNode): string {
  if (n.subtype) return n.subtype
  return n.type
}

export function EntityCardWidget({ node }: { node: GraphNode }) {
  const Icon = typeIcon(node)
  const img = node.images?.[0]
  const portrait = img?.aspect === 'portrait'
  const dateline = formatInstantRange(node.startInstant, node.endInstant, node.precision, node.endInstant != null)

  return (
    <article className="wg-entity" data-type={node.subtype ?? node.type}>
      <figure className={cn('wg-entity-frame', portrait && 'is-portrait')}>
        {img ? (
          <img src={img.url} alt={img.alt ?? node.title} loading="lazy" />
        ) : (
          <span className="wg-entity-placeholder" aria-hidden="true">
            <Icon size={28} />
          </span>
        )}
      </figure>
      <div className="wg-entity-body">
        <span className="wg-entity-kind">
          <Icon size={12} aria-hidden="true" />
          {typeLabel(node)}
        </span>
        <h3 className="wg-entity-title">{node.title}</h3>
        <p className="wg-entity-dateline">{dateline}</p>
        {node.location && (
          <p className="wg-entity-place">
            <MapPin size={12} aria-hidden="true" />
            {node.location}
          </p>
        )}
        {node.summary && <p className="wg-entity-summary">{node.summary}</p>}
      </div>
    </article>
  )
}
