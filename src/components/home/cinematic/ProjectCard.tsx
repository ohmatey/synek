import { Link } from '@tanstack/react-router'
import type { ProjectSummary } from '~/lib/domain/types'
import { hueFromString } from './hue'

// One project on the workspace list page — entering it deep-links to
// /?project=<slug> (the project's own hero + rows). Scoped counts come
// from the page's already-fetched timeline/story lists (no extra round-trip).
export function ProjectCard({
  project,
  timelineCount,
  storyCount,
}: {
  project: ProjectSummary
  timelineCount: number
  storyCount: number
}) {
  return (
    <article className="ch-tl-card">
      <Link
        to="/"
        search={{ project: project.slug }}
        className="ch-tl-open"
        aria-label={`Open project “${project.title}”`}
      >
        <span className="ch-tl-titlerow">
          <span className="ch-proj-titlewrap">
            <span
              className="ch-nav-dot"
              aria-hidden="true"
              style={{ '--dot-hue': hueFromString(project.slug) } as React.CSSProperties}
            />
            <span className="ch-tl-title">{project.title}</span>
          </span>
        </span>
        {project.description && <span className="ch-tl-desc">{project.description}</span>}
        <span className="ch-tl-date">
          {timelineCount} {timelineCount === 1 ? 'timeline' : 'timelines'}
          {' · '}
          {storyCount} {storyCount === 1 ? 'story' : 'stories'}
        </span>
      </Link>
    </article>
  )
}
