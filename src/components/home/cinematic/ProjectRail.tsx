import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { capture } from '~/lib/posthog/client'
import type { ProjectSummary } from '~/lib/domain/types'
import { NewProjectDialog } from './NewProjectDialog'

// The page-level filter (Wren §3): a slim horizontal rail of chips — "All" (only
// when the owner has 2+ projects) + one chip per project + a "New project"
// affordance. Selecting a chip syncs ?project=<slug> (deep-linkable, back-safe)
// WITHOUT navigating away from "/"; the parent resolves the slug → the active
// project client-side. Brand kits used to live here too; they now have their own
// home row (ask #6), so the bar carries only project filtering + New project.
export function ProjectRail({
  projects,
  // The resolved active project (matched from ?project), or null = "All".
  activeProjectId,
}: {
  projects: ProjectSummary[]
  activeProjectId: string | null
}) {
  const navigate = useNavigate({ from: '/' })
  const [newOpen, setNewOpen] = useState(false)

  // Set / clear the ?project search param (slug = the rail's handle). Replace so
  // back doesn't accumulate filter steps; undefined removes the param ("All").
  const select = (slug: string | undefined, projectId: string | null) => {
    if (projectId) capture('home_project_filter_selected', { project_id: projectId })
    void navigate({ search: () => (slug ? { project: slug } : {}), replace: true })
  }

  const showAll = projects.length > 1

  return (
    <nav className="ch-rail" aria-label="Projects">
      {/* The rail is a single-select filter. aria-pressed keeps the toggled look;
          aria-current announces "this is the active scope" (single-select). */}
      {showAll && (
        <button
          type="button"
          className="ch-chip"
          aria-pressed={activeProjectId === null}
          aria-current={activeProjectId === null ? true : undefined}
          onClick={() => select(undefined, null)}
        >
          <span>All</span>
        </button>
      )}
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          className="ch-chip"
          aria-pressed={activeProjectId === p.id}
          aria-current={activeProjectId === p.id ? true : undefined}
          onClick={() => select(p.slug, p.id)}
          title={p.title}
        >
          <span>{p.title}</span>
        </button>
      ))}
      <button type="button" className="ch-chip-new" onClick={() => setNewOpen(true)}>
        <Plus className="size-3.5" />
        New project
      </button>

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(project) => select(project.slug, project.id)}
      />
    </nav>
  )
}
