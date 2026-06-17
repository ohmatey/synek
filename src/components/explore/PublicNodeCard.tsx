import { Link } from '@tanstack/react-router'
import { BookText, Building2, CalendarClock, CalendarRange, Lightbulb, MapPin, User } from 'lucide-react'
import type { NodeSubtype, NodeType, PublicNodeCard as PublicNodeCardDTO } from '~/lib/domain/types'

// Fallback glyph (no image): by entity subtype first (person/org/place/work),
// else by node type.
const SUBTYPE_ICON: Record<NodeSubtype, typeof User> = {
  person: User,
  org: Building2,
  place: MapPin,
  work: BookText,
}
const TYPE_ICON: Record<NodeType, typeof User> = {
  entity: User,
  event: CalendarClock,
  period: CalendarRange,
  concept: Lightbulb,
}
const TYPE_LABEL: Record<NodeType, string> = {
  // No 'entity' label — an entity card is labelled by its subtype instead.
  entity: '',
  event: 'Event',
  period: 'Period',
  concept: 'Concept',
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// One notable node in the Explore "Entities" row — deep-links into the canvas
// focused on it. Shows the node's image when it has one; otherwise a subtype/type
// glyph. Labelled by the entity SUBTYPE (Person/Org/Place/Work) when set, falling
// back to the node type — never the generic "Entity".
export function PublicNodeCard({ node }: { node: PublicNodeCardDTO }) {
  const kind = node.subtype ? cap(node.subtype) : TYPE_LABEL[node.type]
  const Icon = (node.subtype && SUBTYPE_ICON[node.subtype]) || TYPE_ICON[node.type] || User
  return (
    <article className="ch-node-card">
      <Link
        to="/timelines/$id"
        params={{ id: node.timelineId }}
        search={{ node: node.id }}
        className="ch-node-open"
        aria-label={`Open “${node.title}” on ${node.timelineTitle}`}
      >
        <span className="ch-node-media" data-type={node.type} aria-hidden="true">
          {node.imageUrl ? (
            <img src={node.imageUrl} alt={node.imageAlt ?? ''} loading="lazy" />
          ) : (
            <Icon />
          )}
        </span>
        <span className="ch-node-body">
          {kind && <span className="ch-node-kind">{kind}</span>}
          <span className="ch-node-title">{node.title}</span>
          {node.summary && <span className="ch-node-summary">{node.summary}</span>}
          <span className="ch-node-source">{node.timelineTitle}</span>
        </span>
      </Link>
    </article>
  )
}
