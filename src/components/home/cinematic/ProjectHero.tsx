import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Palette, Play, Plus } from 'lucide-react'
import type { ProjectSummary } from '~/lib/domain/types'
import { ProjectBrandingDialog } from '~/components/brand/ProjectBrandingDialog'

// The project page hero — shown when a project is ENTERED (?project=<slug>). It gives
// the project its own identity (title + description + a count line) and the primary
// actions, so a project reads as a destination rather than a filtered list. Reuses the
// all-scope hero's wash styling (.ch-hero) for visual continuity. An empty project
// still gets this hero (its rows show per-group empty states).
export function ProjectHero({
  project,
  timelineCount,
  storyCount,
  entityCount,
  seriesCount = 0,
  firstTimeline,
  onNewTimeline,
}: {
  project: ProjectSummary
  timelineCount: number
  storyCount: number
  entityCount: number
  seriesCount?: number
  // The project's first timeline, to offer an "Open" action.
  firstTimeline: { id: string; title: string } | null
  onNewTimeline: () => void
}) {
  const [brandingOpen, setBrandingOpen] = useState(false)
  const counts = [
    `${timelineCount} ${timelineCount === 1 ? 'timeline' : 'timelines'}`,
    // Series sits before stories in the count line — it's the headline unit (a season
    // of chapters). Shown only when the project has any.
    ...(seriesCount > 0 ? [`${seriesCount} ${seriesCount === 1 ? 'series' : 'series'}`] : []),
    `${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`,
    `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`,
  ].join(' · ')

  return (
    <section className="ch-hero ch-project-hero" data-wash aria-label={`Project: ${project.title}`}>
      <div className="ch-hero-body">
        <p className="ch-project-eyebrow">Project · {counts}</p>
        <h1 className="ch-empty-title">{project.title}</h1>
        {project.description && <p className="ch-empty-body">{project.description}</p>}
        <div className="ch-hero-actions">
          {firstTimeline ? (
            <Link to="/timelines/$id" params={{ id: firstTimeline.id }} className="ch-play">
              <Play aria-hidden="true" />
              Open {firstTimeline.title}
            </Link>
          ) : (
            <button type="button" className="ch-play" onClick={onNewTimeline}>
              <Plus aria-hidden="true" />
              New timeline
            </button>
          )}
          {firstTimeline && (
            <button type="button" className="ch-secondary" onClick={onNewTimeline}>
              <Plus aria-hidden="true" />
              New timeline
            </button>
          )}
          <button type="button" className="ch-secondary" onClick={() => setBrandingOpen(true)}>
            <Palette aria-hidden="true" />
            Customize
          </button>
        </div>
      </div>

      <ProjectBrandingDialog open={brandingOpen} onOpenChange={setBrandingOpen} projectId={project.id} />
    </section>
  )
}
