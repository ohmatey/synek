import { useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Palette, Plus } from 'lucide-react'
import { listProjects } from '~/lib/server/projects'
import { listTimelines } from '~/lib/server/timelines'
import { listHomeStories } from '~/lib/server/stories'
import { listApiKeys } from '~/lib/server/api-keys'
import { listBrands } from '~/lib/server/brands'
import { BrandManagerDialog } from '~/components/brand/BrandManagerDialog'
import { NewTimelineDialog } from './NewTimelineDialog'
import {
  BrandCard,
  CinematicHero,
  FeaturedStory,
  HomeContentRow,
  ProjectRail,
  StoryCard,
  TimelineCard,
} from './cinematic'

// The cinematic stories-first home. The signed-in dashboard: a project rail filters
// the whole page via ?project=<slug>; a contained featured-story unit (with ‹/›
// over recent stories) leads the all-scope view; "Your stories" / "Timelines" /
// "Brand kits" carousels sit below. The project view drops the featured unit and
// shows every group with an empty state. Polling keeps it fresh while an MCP client
// builds in another tab.
export function SignedIn() {
  // The page-level filter — a slug; resolved to a project client-side (an unknown/
  // foreign/garbage slug matches nothing and degrades to "All", never a 404).
  const { project: projectSlug } = useSearch({ from: '/' })
  const [newTimelineOpen, setNewTimelineOpen] = useState(false)
  const [brandsOpen, setBrandsOpen] = useState(false)

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
  // Brand kits are owner-level (not project-scoped), so the same list shows in both
  // scopes — they're account assets the creator dresses a project with.
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => listBrands() })
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  const hasApiKey = (apiKeys?.length ?? 0) > 0

  const loading = tlLoading || stLoading
  const hasStories = stories.length > 0
  const hasTimelines = timelines.length > 0
  const hasBrands = brands.length > 0

  // Per-timeline current-project map for the story-card move submenu (the story's
  // timeline determines where it lives).
  const timelineProjectById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of timelines) m.set(t.id, t.projectId)
    return m
  }, [timelines])

  const openNewTimeline = () => setNewTimelineOpen(true)
  const linkProject = activeProject ? { id: activeProject.id, title: activeProject.title } : null

  // The all-scope hero: a full new-creator empty when the account is bare, a
  // "write your first story" nudge when there are timelines but no stories, else
  // the featured-story unit. The project view never shows a hero.
  const trulyNew = !filtered && !hasTimelines && !hasStories
  const nudgeStory = !filtered && hasTimelines && !hasStories

  return (
    <div className="ch-home">
      <ProjectRail projects={projects} activeProjectId={activeProjectId} />

      {loading ? (
        <div className="ch-featured-skeleton" aria-hidden="true" />
      ) : trulyNew ? (
        <CinematicHero
          variant="new-creator"
          projectName={null}
          hasApiKey={hasApiKey}
          onNewTimeline={openNewTimeline}
        />
      ) : nudgeStory ? (
        <CinematicHero
          variant="no-stories"
          projectName={null}
          hasApiKey={hasApiKey}
          onNewTimeline={openNewTimeline}
          firstTimeline={timelines[0] ?? null}
          timelineCount={timelines.length}
        />
      ) : !filtered && hasStories ? (
        <FeaturedStory stories={stories} projectName={activeProjectName} projectId={activeProjectId} />
      ) : null}

      {/* Rows. All-scope: only groups that have content (+ brand kits when any).
          Project view: every group, with an empty state (ask #8). */}
      {!loading && !trulyNew && (
        <div className="ch-rows">
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

          {(hasBrands || filtered) && (
            <HomeContentRow
              title="Brand kits"
              action={
                <button type="button" className="ch-chip-new" onClick={() => setBrandsOpen(true)}>
                  <Palette className="size-3.5" />
                  New brand kit
                </button>
              }
              isEmpty={!hasBrands}
              emptyState={
                <p className="ch-empty-note">
                  No brand kits yet — author one to dress your stories on-brand.
                </p>
              }
            >
              {brands.map((b) => (
                <BrandCard key={b.id} brand={b} linkProject={linkProject} />
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
      {/* Row-level "New brand kit" + empty-state manager (cards open their own). */}
      <BrandManagerDialog open={brandsOpen} onOpenChange={setBrandsOpen} linkProject={linkProject} />
    </div>
  )
}
