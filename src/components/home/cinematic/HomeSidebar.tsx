import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Layers, Palette, Plus } from 'lucide-react'
import { capture } from '~/lib/posthog/client'
import type { ProjectSummary } from '~/lib/domain/types'
import { NewProjectDialog } from './NewProjectDialog'
import { hueFromString } from './hue'

// The home's primary navigation: a left sidebar that lists Projects (the top-level
// container) as a vertical nav, replacing the old chip-filter rail. Selecting a
// project ENTERS it — `?project=<slug>` deep-links to that project's page (its own
// hero + rows); "All" returns to the cross-project dashboard. `?project` is the
// single source of truth (back-safe, replace-on-select). The footer hosts account
// assets (Brand kits). On narrow viewports CSS turns this into a horizontal strip.
export function HomeSidebar({
  projects,
  activeProjectId,
  onOpenBrands,
}: {
  projects: ProjectSummary[]
  // The resolved active project (matched from ?project), or null = "All".
  activeProjectId: string | null
  // Open the brand-kit manager (state is owned by the page).
  onOpenBrands: () => void
}) {
  const navigate = useNavigate({ from: '/' })
  const [newOpen, setNewOpen] = useState(false)

  const select = (slug: string | undefined, projectId: string | null) => {
    if (projectId) capture('home_project_filter_selected', { project_id: projectId })
    void navigate({ search: () => (slug ? { project: slug } : {}), replace: true })
  }

  return (
    <div className="ch-sidebar">
      {/* The Projects nav — only project items + New project (Brand kits lives in the
          footer, OUTSIDE this nav, so it isn't announced as a project). */}
      <nav className="ch-sidebar-nav" aria-label="Projects">
        <p className="ch-sidebar-label" id="ch-sidebar-projects">
          Projects
        </p>
        <ul className="ch-sidebar-list" aria-labelledby="ch-sidebar-projects">
          <li>
            <button
              type="button"
              className="ch-nav-item"
              aria-current={activeProjectId === null ? 'page' : undefined}
              onClick={() => select(undefined, null)}
            >
              <Layers className="ch-nav-icon" aria-hidden="true" />
              <span className="ch-nav-text">All projects</span>
            </button>
          </li>
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="ch-nav-item"
                aria-current={activeProjectId === p.id ? 'page' : undefined}
                onClick={() => select(p.slug, p.id)}
                title={p.title}
              >
                <span
                  className="ch-nav-dot"
                  aria-hidden="true"
                  style={{ '--dot-hue': hueFromString(p.slug) } as React.CSSProperties}
                />
                <span className="ch-nav-text">{p.title}</span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="ch-nav-item ch-nav-add" onClick={() => setNewOpen(true)}>
          <Plus className="ch-nav-icon" aria-hidden="true" />
          <span className="ch-nav-text">New project</span>
        </button>
      </nav>

      {/* Account assets — not projects, so outside the Projects nav. */}
      <div className="ch-sidebar-foot">
        <button type="button" className="ch-nav-item" onClick={onOpenBrands}>
          <Palette className="ch-nav-icon" aria-hidden="true" />
          <span className="ch-nav-text">Brand kits</span>
        </button>
      </div>

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(project) => select(project.slug, project.id)}
      />
    </div>
  )
}
