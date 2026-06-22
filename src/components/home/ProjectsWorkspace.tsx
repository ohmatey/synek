import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { listProjects } from '~/lib/server/projects'
import { listTimelines } from '~/lib/server/timelines'
import { listHomeStories } from '~/lib/server/stories'
import { listHomeSeries } from '~/lib/server/series'
import { listHomeEntities } from '~/lib/server/entities'
import { listApiKeys } from '~/lib/server/api-keys'
import { useSession } from '~/lib/auth/client'
import type { ProjectSummary, TimelineSummary } from '~/lib/domain/types'
import { Button } from '~/components/ui/button'
import { AppHeader } from './AppHeader'
import { NewTimelineDialog } from './NewTimelineDialog'
import {
  CinematicHero,
  EntitiesDisclosure,
  NewProjectDialog,
  ProjectCard,
  ProjectHero,
  RecentCard,
  type RecentItem,
  SeriesCard,
  TimelineCard,
} from './cinematic'
import type { HomeSeriesCard } from '~/lib/domain/types'

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
  const { data: series = [], isLoading: srLoading } = useQuery({
    queryKey: ['home-series', activeProjectId],
    queryFn: () => listHomeSeries({ data: activeProjectId ? { projectId: activeProjectId } : undefined }),
    refetchInterval: 30_000,
  })
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  const hasApiKey = (apiKeys?.length ?? 0) > 0

  const loading = tlLoading || stLoading || enLoading || srLoading
  const hasStories = stories.length > 0
  const hasTimelines = timelines.length > 0
  const hasEntities = entities.length > 0
  const hasSeries = series.length > 0

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

  // The "Recently updated" feed: stories and timelines merged and time-sorted, so
  // the home reads as "what changed" across the graph rather than four type-grouped
  // catalogs. Scoped by the same activeProjectId the queries above use.
  const recentItems = useMemo<RecentItem[]>(() => {
    const items: RecentItem[] = [
      ...stories.map((s) => ({ kind: 'story' as const, id: s.storyId, updatedAt: s.updatedAt, story: s })),
      ...timelines.map((t) => ({ kind: 'timeline' as const, id: t.id, updatedAt: t.updatedAt, timeline: t })),
    ]
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
  }, [stories, timelines])

  const openNewTimeline = () => setNewTimelineOpen(true)

  // The all-scope page is a brand-new empty when the account is bare; otherwise the
  // projects-list page. A project that's been ENTERED gets its own ProjectHero.
  const trulyNew = !filtered && !hasTimelines && !hasStories && !hasEntities && !hasSeries

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
              seriesCount={series.length}
              firstTimeline={timelines[0] ?? null}
              onNewTimeline={openNewTimeline}
            />
          ) : trulyNew ? (
            <CinematicHero hasApiKey={hasApiKey} onNewTimeline={openNewTimeline} />
          ) : null}

          {!loading && !trulyNew && (
            <div className="ch-rows">
              {/* Section 1 — the durable containers. The list page shows the owner's
                  WORLDS (projects); a project view shows that project's TIMELINES. */}
              {filtered ? (
                <TimelinesSection timelines={timelines} projects={projects} onNewTimeline={openNewTimeline} />
              ) : (
                <ProjectsGrid projects={projects} counts={projectCounts} onNewTimeline={openNewTimeline} />
              )}

              {/* Series — serialized seasons (ADR 0006). Shown whenever the scope has
                  any; each card opens its /sr/$slug season (public) or offers Share. */}
              {hasSeries && <SeriesSection series={series} />}

              {/* Section 2 — the temporal feed: stories + timelines, most-recent first. */}
              {recentItems.length > 0 && (
                <RecentlyUpdatedSection
                  items={recentItems}
                  projects={projects}
                  timelineProjectById={timelineProjectById}
                  activeProjectId={activeProjectId}
                />
              )}

              {/* Entities, demoted from a top-level row to an opt-in disclosure. */}
              <EntitiesDisclosure entities={entities} />
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
  onNewTimeline,
}: {
  projects: ProjectSummary[]
  counts: Map<string, { timelines: number; stories: number }>
  onNewTimeline: () => void
}) {
  const navigate = useNavigate({ from: '/' })
  const [newOpen, setNewOpen] = useState(false)
  return (
    <section className="ch-row" aria-label="Projects">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Projects</h2>
        <div className="ch-row-head-actions">
          {/* New timeline stays reachable from the list page (it lands in the default
              project); New project creates a fresh container. */}
          <button type="button" className="ch-chip-new" onClick={onNewTimeline}>
            <Plus className="size-3.5" />
            New timeline
          </button>
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

// Section 1 inside a project view — that project's timelines as a wrapping grid
// (not a clipped carousel), with a New timeline action and an empty-state note.
function TimelinesSection({
  timelines,
  projects,
  onNewTimeline,
}: {
  timelines: TimelineSummary[]
  projects: ProjectSummary[]
  onNewTimeline: () => void
}) {
  return (
    <section className="ch-row" aria-label="Timelines">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Timelines</h2>
        <div className="ch-row-head-actions">
          <button type="button" className="ch-chip-new" onClick={onNewTimeline}>
            <Plus className="size-3.5" />
            New timeline
          </button>
        </div>
      </header>
      {timelines.length === 0 ? (
        <div className="ch-row-empty">
          <p className="ch-empty-note">
            No timelines yet — create one and your connected Claude builds it out.
          </p>
        </div>
      ) : (
        <div className="ch-proj-grid">
          {timelines.map((t) => (
            <TimelineCard key={t.id} timeline={t} projects={projects} />
          ))}
        </div>
      )}
    </section>
  )
}

// Series — the serialized seasons in scope, as a wrapping grid of season posters.
// Owner-scoped + project-filtered upstream (listHomeSeries); newest first.
function SeriesSection({ series }: { series: HomeSeriesCard[] }) {
  return (
    <section className="ch-row" aria-label="Series">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Series</h2>
      </header>
      <div className="ch-proj-grid">
        {series.map((s) => (
          <SeriesCard key={s.seriesId} series={s} />
        ))}
      </div>
    </section>
  )
}

// Section 2 — the time-sorted "what changed" feed (stories + timelines), rendered
// as a wrapping grid of unified poster cards. Each card resolves its timeline's
// current project (for the move-to-project submenu).
function RecentlyUpdatedSection({
  items,
  projects,
  timelineProjectById,
  activeProjectId,
}: {
  items: RecentItem[]
  projects: ProjectSummary[]
  timelineProjectById: Map<string, string | null>
  activeProjectId: string | null
}) {
  return (
    <section className="ch-row" aria-label="Recently updated">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Recently updated</h2>
      </header>
      <div className="ch-recent-grid">
        {items.map((it) => {
          const currentProjectId =
            it.kind === 'story' ? (timelineProjectById.get(it.story.timelineId) ?? activeProjectId) : it.timeline.projectId
          return <RecentCard key={`${it.kind}:${it.id}`} item={it} projects={projects} currentProjectId={currentProjectId} />
        })}
      </div>
    </section>
  )
}
