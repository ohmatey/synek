import { Link } from '@tanstack/react-router'
import { CalendarRange, Lightbulb, User, Zap } from 'lucide-react'
import type { HomeEntityCard, NodeType } from '~/lib/domain/types'
import { hueFromString } from './hue'

// A node-type icon for the image-less fallback wash + the meta line. Entities are
// "canonical node content" of any type (event/entity/period/concept), so the icon
// reads the entity's type, not the `entity` NodeType specifically.
const TYPE_ICON: Record<NodeType, typeof Zap> = {
  event: Zap,
  entity: User,
  period: CalendarRange,
  concept: Lightbulb,
}
const TYPE_LABEL: Record<NodeType, string> = {
  event: 'Event',
  entity: 'Entity',
  period: 'Period',
  concept: 'Concept',
}

// One entity in the home's "Entities" row — a vertical poster mirroring StoryCard's
// shell (cover + body + meta). Clicking the card opens the entity's canonical node
// page (its first placement). The meta line carries the entity TYPE and its reach —
// "on N timelines" — the signal that this is shared content, not a one-off node.
export function EntityCard({ entity }: { entity: HomeEntityCard }) {
  const Icon = TYPE_ICON[entity.type]
  const { timelineCount } = entity

  return (
    <article className="ch-card">
      <Link
        to="/timelines/$id/nodes/$nodeId"
        params={{ id: entity.primaryTimelineId, nodeId: entity.primaryNodeId }}
        className="ch-card-open"
        aria-label={`Open “${entity.title}”`}
      >
        <span
          className="ch-card-cover"
          data-wash={entity.thumbnail ? undefined : true}
          style={
            entity.thumbnail ? undefined : ({ '--cover-hue': hueFromString(entity.entityId) } as React.CSSProperties)
          }
        >
          {entity.thumbnail ? (
            <img src={entity.thumbnail.url} alt={entity.thumbnail.alt ?? ''} loading="lazy" />
          ) : (
            <span className="ch-card-cover-fallback" aria-hidden="true">
              <Icon />
            </span>
          )}
        </span>
        <span className="ch-card-body">
          <span className="ch-card-title">{entity.title}</span>
          {entity.summary && <span className="ch-card-hook">{entity.summary}</span>}
          <span className="ch-card-meta">
            <span>{TYPE_LABEL[entity.type]}</span>
            <span className="ch-card-dot" aria-hidden="true">
              ·
            </span>
            <span>
              {timelineCount === 1 ? 'on 1 timeline' : `on ${timelineCount} timelines`}
            </span>
          </span>
        </span>
      </Link>
    </article>
  )
}
