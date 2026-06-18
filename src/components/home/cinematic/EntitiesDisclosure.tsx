import { useState } from 'react'
import { ChevronRight, Users } from 'lucide-react'
import type { HomeEntityCard } from '~/lib/domain/types'
import { EntityCard } from './EntityCard'

// Entities (people, places & ideas) are reusable building blocks, not browse-first
// content — so they're demoted from a top-level carousel to a single collapsed
// disclosure under the two main sections. Open it to reveal the entity grid inline.
// Renders nothing when the owner has no entities.
export function EntitiesDisclosure({ entities }: { entities: HomeEntityCard[] }) {
  const [open, setOpen] = useState(false)
  if (entities.length === 0) return null

  return (
    <section className="ch-row ch-entities" aria-label="People, places and ideas">
      <button
        type="button"
        className="ch-disclosure"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Users className="size-4" aria-hidden="true" />
        <span className="ch-disclosure-label">People, places &amp; ideas</span>
        <span className="ch-disclosure-count">{entities.length}</span>
        <ChevronRight className="ch-disclosure-chevron size-4" aria-hidden="true" data-open={open || undefined} />
      </button>
      {open && (
        <div className="ch-recent-grid">
          {entities.map((e) => (
            <EntityCard key={e.entityId} entity={e} />
          ))}
        </div>
      )}
    </section>
  )
}
