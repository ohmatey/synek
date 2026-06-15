import { useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { listProjects } from '~/lib/server/projects'
import { listTimelines } from '~/lib/server/timelines'
import { listHomeStories } from '~/lib/server/stories'
import { listApiKeys } from '~/lib/server/api-keys'
import { NewTimelineDialog } from './NewTimelineDialog'
import {
  CinematicHero,
  HomeContentRow,
  ProjectRail,
  StoryCard,
  TimelineCard,
} from './cinematic'

// The cinematic stories-first home (Wren cinematic-home.md / PRD local-127). The
// signed-in dashboard: a project rail filters the whole page via ?project=<slug>;
// the hero leads with the featured story; "Your stories" + "Timelines" carousels
// sit below. Polling keeps it fresh while an MCP client builds in another tab.
export function SignedIn() {
  // The page-level filter — a slug; resolved to a project client-side (an unknown/
  // foreign/garbage slug matches nothing and degrades to "All", never a 404).
  const { project: projectSlug } = useSearch({ from: '/' })
  const [newTimelineOpen, setNewTimelineOpen] = useState(false)

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })

  // Resolve the active project from the slug against the OWNER'S projects — the
  // soft-fallback gate (PRD US3): no match → null → "All" scope.
  const activeProject = useMemo(
    () => (projectSlug ? (projects.find((p) => p.slug === projectSlug) ?? null) : null),
    [projects, projectSlug],
  )
  const activeProjectId = activeProject?.id ?? null

  // All three reads narrow to the active project (or all, when null). Keys per the
  // task's suggestion; the project id (not the slug) is the cache key. Polling
  // surfaces MCP-client builds without SSE (PRD §6).
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
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  const hasApiKey = (apiKeys?.length ?? 0) > 0

  const loading = tlLoading || stLoading

  // Featured story (PRD US2): the most-recently-updated story WITH a cover in scope;
  // else the most-recently-updated story overall (branded wash). `stories` is already
  // sorted updatedAt-desc by the server fn, so the first covered one is the pick.
  const featured = useMemo(
    () => stories.find((s) => s.coverImage) ?? stories[0] ?? null,
    [stories],
  )

  // Per-timeline current-project map for the story-card move submenu (the story's
  // timeline determines where it lives). Falls back to the active project when the
  // map misses (project-filtered scope) and finally to the timeline's own projectId.
  const timelineProjectById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of timelines) m.set(t.id, t.projectId)
    return m
  }, [timelines])

  const openNewTimeline = () => setNewTimelineOpen(true)

  // Empty-state selection (PRD US7-US9). Project-filtered & truly empty → directive.
  let emptyVariant: 'new-creator' | 'empty-project' | 'no-stories' | null = null
  if (!loading) {
    if (timelines.length === 0) {
      emptyVariant = activeProject ? 'empty-project' : 'new-creator'
    } else if (stories.length === 0) {
      emptyVariant = 'no-stories'
    }
  }

  return (
    <div className="ch-home">
      <ProjectRail projects={projects} activeProjectId={activeProjectId} />

      {/* Hero — skip rendering until the first load resolves to avoid a wash flash. */}
      {loading ? (
        <div className="ch-hero" data-wash aria-hidden="true" />
      ) : featured && !emptyVariant ? (
        <CinematicHero
          kind="story"
          story={featured}
          projectName={activeProject?.title ?? null}
          projectId={activeProjectId}
        />
      ) : (
        <CinematicHero
          kind="empty"
          variant={emptyVariant ?? 'new-creator'}
          projectName={activeProject?.title ?? null}
          hasApiKey={hasApiKey}
          onNewTimeline={openNewTimeline}
          firstTimeline={timelines[0] ?? null}
          timelineCount={timelines.length}
        />
      )}

      {/* Rows — only once there's content; a fully empty page is just the hero. */}
      {!loading && (timelines.length > 0 || stories.length > 0) && (
        <div className="ch-rows">
          {stories.length > 0 && (
            <HomeContentRow title="Your stories">
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
          {timelines.length > 0 && (
            <HomeContentRow
              title="Timelines"
              action={
                <button type="button" className="ch-chip-new" onClick={openNewTimeline}>
                  <Plus className="size-3.5" />
                  New timeline
                </button>
              }
            >
              {timelines.map((t) => (
                <TimelineCard key={t.id} timeline={t} projects={projects} />
              ))}
            </HomeContentRow>
          )}
        </div>
      )}

      <NewTimelineDialog
        open={newTimelineOpen}
        onOpenChange={setNewTimelineOpen}
        projectId={activeProjectId ?? undefined}
      />
    </div>
  )
}
