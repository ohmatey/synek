import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { listProjects } from '~/lib/server/projects'
import { listTimelines } from '~/lib/server/timelines'
import { listHomeStories } from '~/lib/server/stories'
import { listHomeEntities } from '~/lib/server/entities'
import { listApiKeys } from '~/lib/server/api-keys'
import { useSession } from '~/lib/auth/client'
import type { ProjectSummary } from '~/lib/domain/types'
import { Button } from '~/components/ui/button'
import { AppHeader } from './AppHeader'
import { NewTimelineDialog } from './NewTimelineDialog'
import {
  CinematicHero,
  EntityCard,
  HomeContentRow,
  NewProjectDialog,
  ProjectCard,
  ProjectHero,
  StoryCard,
  TimelineCard,
} from './cinematic'

// The signed-in workspace, served at the root `/` (Synek is a pure app — no
// landing page or public Explore feed). Two modes:
//
//   • the LIST page (no ?project): a grid of the owner's projects, then aggregate
//     "Your stories" / "Timelines" rows across all projects.
//   • a PROJECT page (?project=<slug>): that project's own hero + per-group rows.
//     Theme + brand voice are built into each project (its hero's "Customize" → the
//     ProjectBrandingDialog), replacing the former per-account brand-kit library.
//
// `?project` is the single source of truth (the /p/$slug route + project cards
// deep-link to it). Polling keeps it fresh while an MCP client builds elsewhere.
export function ProjectsWorkspace() {
  const { data: session, isPending } = useSession()

  // /projects is owner-scoped (every fetch below calls requireUser). Gate on the
  // session so a signed-out visitor gets a clean prompt, not failing RPCs.
  if (isPending) {
    return (
      <div className="flex min-h-screen flex-col text-foreground">
        <AppHeader />
        <div className="ch-featured-skeleton" aria-hidden="true" />
      </div>
    )
  }
  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col text-foreground">
        <AppHeader />
        <main className="grid flex-1 place-items-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Your projects</h1>
            <p className="text-muted-foreground">Sign in to see your projects, timelines and stories.</p>
            <Button asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return <Workspace />
}

function Workspace() {
  const { project: projectSlug } = useSearch({ from: '/' })
  const [newTimelineOpen, setNewTimelineOpen] = useState(false)

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })

  const activeProject = useMemo(
    () => (projectSlug ? (projects.find((p) => p.slug === projectSlug) ?? null) : null),
    [projects, projectSlug],
  )
  const activeProjectId = activeProject?.id ?? null
  const activeProjectName = activeProject?.title ?? null
  const filtered = !!activeProject

  const { data: timelines = [], isLoading: tlLoading } = useQuery({
    queryKey: ['timelines', activeProjectId],
    queryFn: () => listTimelines({ data: activeProjectId ? { projectId: activeProjectId } : undefined }),
    refetchInterval: 30_000,
  })
  const { data: stories = [], isLoading: stLoading } = useQuery({
    queryKey: ['home-stories', activeProjectId],
    queryFn: () => listHomeStories({ data: activeProjectId ? { projectId: activeProjectId } : undefined }),
    refetchInterval: 30_000,
  })
  const { data: entities = [], isLoading: enLoading } = useQuery({
    queryKey: ['home-entities', activeProjectId],
    queryFn: () => listHomeEntities({ data: activeProjectId ? { projectId: activeProjectId } : undefined }),
    refetchInterval: 30_000,
  })
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  const hasApiKey = (apiKeys?.length ?? 0) > 0

  const loading = tlLoading || stLoading || enLoading
  const hasStories = stories.length > 0
  const hasTimelines = timelines.length > 0
  const hasEntities = entities.length > 0

  // Per-timeline current-project map for the story-card move submenu + per-project
  // counts on the list-page project cards (the story's timeline determines where it
  // lives).
  const timelineProjectById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of timelines) m.set(t.id, t.projectId)
    return m
  }, [timelines])

  // Scoped counts for each project card (All scope only — timelines/stories are
  // unfiltered there). Cheap client-side tally, no extra round-trips.
  const projectCounts = useMemo(() => {
    const m = new Map<string, { timelines: number; stories: number }>()
    for (const p of projects) m.set(p.id, { timelines: 0, stories: 0 })
    for (const t of timelines) if (t.projectId && m.has(t.projectId)) m.get(t.projectId)!.timelines++
    for (const s of stories) {
      const pid = timelineProjectById.get(s.timelineId)
      if (pid && m.has(pid)) m.get(pid)!.stories++
    }
    return m
  }, [projects, timelines, stories, timelineProjectById])

  const openNewTimeline = () => setNewTimelineOpen(true)

  // The all-scope page is a brand-new empty when the account is bare; otherwise the
  // projects-list page. A project that's been ENTERED gets its own ProjectHero.
  const trulyNew = !filtered && !hasTimelines && !hasStories && !hasEntities

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main className="flex-1">
        <div className="ch-home">
          {loading ? (
            <div className="ch-featured-skeleton" aria-hidden="true" />
          ) : filtered && activeProject ? (
            <ProjectHero
              project={activeProject}
              timelineCount={timelines.length}
              storyCount={stories.length}
              entityCount={entities.length}
              firstTimeline={timelines[0] ?? null}
              onNewTimeline={openNewTimeline}
            />
          ) : trulyNew ? (
            <CinematicHero hasApiKey={hasApiKey} onNewTimeline={openNewTimeline} />
          ) : null}

          {!loading && !trulyNew && (
            <div className="ch-rows">
              {/* The list page leads with the Projects grid (the "projects list page"
                  the header's Projects button opens). The project view skips it. */}
              {!filtered && <ProjectsGrid projects={projects} counts={projectCounts} />}

              {(hasStories || filtered) && (
                <HomeContentRow
                  title="Your stories"
                  isEmpty={!hasStories}
                  emptyState={
                    <p className="ch-empty-note">
                      No stories yet — open a timeline and let your AI tell its story.
                    </p>
                  }
                >
                  {stories.map((s) => (
                    <StoryCard
                      key={s.storyId}
                      story={s}
                      projects={projects}
                      currentProjectId={timelineProjectById.get(s.timelineId) ?? activeProjectId}
                    />
                  ))}
                </HomeContentRow>
              )}

              {(hasTimelines || filtered) && (
                <HomeContentRow
                  title="Timelines"
                  action={
                    <button type="button" className="ch-chip-new" onClick={openNewTimeline}>
                      <Plus className="size-3.5" />
                      New timeline
                    </button>
                  }
                  isEmpty={!hasTimelines}
                  emptyState={
                    <p className="ch-empty-note">
                      No timelines yet — create one and your connected Claude builds it out.
                    </p>
                  }
                >
                  {timelines.map((t) => (
                    <TimelineCard key={t.id} timeline={t} projects={projects} />
                  ))}
                </HomeContentRow>
              )}

              {(hasEntities || filtered) && (
                <HomeContentRow
                  title="Entities"
                  isEmpty={!hasEntities}
                  emptyState={
                    <p className="ch-empty-note">
                      No entities yet — the people, places and ideas your AI adds to a timeline show up here,
                      reusable across every timeline.
                    </p>
                  }
                >
                  {entities.map((e) => (
                    <EntityCard key={e.entityId} entity={e} />
                  ))}
                </HomeContentRow>
              )}
            </div>
          )}
        </div>
      </main>

      <NewTimelineDialog
        open={newTimelineOpen}
        onOpenChange={setNewTimelineOpen}
        projectId={activeProjectId ?? undefined}
      />
    </div>
  )
}

// The projects list — a labelled grid of project cards + New project. This is the
// page the header's Projects button opens (the "projects list page"). Creating a
// project enters it (?project=<slug>), matching the old sidebar's select-on-create.
function ProjectsGrid({
  projects,
  counts,
}: {
  projects: ProjectSummary[]
  counts: Map<string, { timelines: number; stories: number }>
}) {
  const navigate = useNavigate({ from: '/' })
  const [newOpen, setNewOpen] = useState(false)
  return (
    <section className="ch-row" aria-label="Projects">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Projects</h2>
        <div className="ch-row-head-actions">
          <button type="button" className="ch-chip-new" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" />
            New project
          </button>
        </div>
      </header>
      <div className="ch-proj-grid">
        {projects.map((p) => {
          const c = counts.get(p.id) ?? { timelines: 0, stories: 0 }
          return <ProjectCard key={p.id} project={p} timelineCount={c.timelines} storyCount={c.stories} />
        })}
      </div>
      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(project) => void navigate({ search: { project: project.slug } })}
      />
    </section>
  )
}
