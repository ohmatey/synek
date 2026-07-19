import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, BookOpenText, Layers, Palette, Play, Plus } from 'lucide-react'
import { listTimelines } from '~/lib/server/timelines'
import { listHomeStories } from '~/lib/server/stories'
import { listHomeSeries } from '~/lib/server/series'
import { listHomeEntities } from '~/lib/server/entities'
import { listApiKeys } from '~/lib/server/api-keys'
import { listBrands, getDefaultBrandId, type BrandSummary } from '~/lib/server/brands'
import { useSession } from '~/lib/auth/client'
import type { HomeSeriesCard, HomeStoryCard, TimelineSummary } from '~/lib/domain/types'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { BrandLibraryDialog } from '~/components/brand/BrandLibraryDialog'
import { AppHeader } from './AppHeader'
import { NewTimelineDialog } from './NewTimelineDialog'
import { NewStoryDialog, type CreateMode } from './NewStoryDialog'
import {
  CinematicHero,
  EntitiesDisclosure,
  RecentCard,
  type RecentItem,
  SeriesCard,
  TimelineCard,
  useStoryActions,
} from './cinematic'

// The signed-in workspace, served at the root `/` (Synek is a pure, stories-first
// app — no landing page, no Explore feed, and no project surfaces). Projects still
// exist as invisible plumbing (every timeline has a projectId via ensureDefaultProject;
// MCP clients can organize into projects) but the UI never mentions them: the home
// leads with the owner's STORIES and SERIES. All reads are all-scope and owner-scoped;
// polling keeps them fresh while an MCP client builds elsewhere.
export function ProjectsWorkspace() {
  const { data: session, isPending } = useSession()

  // Owner-scoped (every fetch below calls requireUser). Gate on the session so a
  // signed-out visitor gets a clean prompt, not failing RPCs.
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
        <main id="main" className="grid flex-1 place-items-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Your stories</h1>
            <p className="text-muted-foreground">Sign in to see your stories, series and timelines.</p>
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
  const [newTimelineOpen, setNewTimelineOpen] = useState(false)
  // The "New story" / "New series" flow (empty-state starters + the library action
  // bar). Null when closed; carries the mode + any starter preset while open.
  const [create, setCreate] = useState<{ mode: CreateMode; title: string; topic: string } | null>(null)
  // The Brand kits library (ADR-0007 home row). Null = closed; `editId` jumps to a
  // kit's editor (card click), `create` opens a fresh kit (the "New brand" action).
  const [brandDialog, setBrandDialog] = useState<{ editId: string | null; create: boolean } | null>(null)

  const { data: timelines = [], isLoading: tlLoading } = useQuery({
    queryKey: ['timelines'],
    queryFn: () => listTimelines(),
    refetchInterval: 30_000,
  })
  const { data: stories = [], isLoading: stLoading } = useQuery({
    queryKey: ['home-stories'],
    queryFn: () => listHomeStories(),
    refetchInterval: 30_000,
  })
  const { data: entities = [], isLoading: enLoading } = useQuery({
    queryKey: ['home-entities'],
    queryFn: () => listHomeEntities(),
    refetchInterval: 30_000,
  })
  const { data: series = [], isLoading: srLoading } = useQuery({
    queryKey: ['home-series'],
    queryFn: () => listHomeSeries(),
    refetchInterval: 30_000,
  })
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  const hasApiKey = (apiKeys?.length ?? 0) > 0
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(), refetchInterval: 30_000 })
  const { data: defaultBrandId = null } = useQuery({ queryKey: ['default-brand'], queryFn: () => getDefaultBrandId() })

  const loading = tlLoading || stLoading || enLoading || srLoading
  const hasStories = stories.length > 0
  const hasTimelines = timelines.length > 0
  const hasEntities = entities.length > 0
  const hasSeries = series.length > 0

  // The "Recently updated" feed: stories and timelines merged and time-sorted, so the
  // home reads as "what changed" rather than type-grouped catalogs.
  const recentItems = useMemo<RecentItem[]>(() => {
    const items: RecentItem[] = [
      ...stories.map((s) => ({ kind: 'story' as const, id: s.storyId, updatedAt: s.updatedAt, story: s })),
      ...timelines.map((t) => ({ kind: 'timeline' as const, id: t.id, updatedAt: t.updatedAt, timeline: t })),
    ]
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
  }, [stories, timelines])

  const openNewTimeline = () => setNewTimelineOpen(true)
  const startCreate = (mode: CreateMode, preset?: { title?: string; topic?: string }) =>
    setCreate({ mode, title: preset?.title ?? '', topic: preset?.topic ?? '' })

  // Brand-new empty account → the cinematic empty hero; otherwise the stories-first home.
  const trulyNew = !hasTimelines && !hasStories && !hasEntities && !hasSeries

  // The populated home leads with a cinematic featured-story hero (design Principle 2:
  // gravity at the top, navigation below). `stories` is newest-updatedAt-first, so the
  // head is the most-recently-touched story. Null when the owner has only timelines.
  const featured = hasStories ? stories[0] : null

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main id="main" className="flex-1">
        <div className="ch-home">
          {loading ? (
            <div className="ch-featured-skeleton" aria-hidden="true" />
          ) : trulyNew ? (
            <CinematicHero hasApiKey={hasApiKey} onStart={startCreate} onNewTimeline={openNewTimeline} />
          ) : null}

          {!loading && !trulyNew && featured && <FeaturedHero story={featured} />}

          {!loading && !trulyNew && (
            <div className="ch-rows">
              <LibraryActions onStart={startCreate} onNewTimeline={openNewTimeline} />

              {/* The temporal feed leads: stories + timelines, most-recent first. */}
              {recentItems.length > 0 && <RecentlyUpdatedSection items={recentItems} />}

              {/* Series — serialized seasons (ADR 0006). */}
              {hasSeries && <SeriesSection series={series} />}

              {/* Brand kits — the identity layer stories/series dress in (ADR 0007).
                  Always on the populated home (incl. empty) so it stays discoverable. */}
              <BrandKitsSection
                brands={brands}
                defaultBrandId={defaultBrandId}
                onOpen={(editId) => setBrandDialog({ editId, create: false })}
                onNew={() => setBrandDialog({ editId: null, create: true })}
              />

              {/* All timelines (the substrate). */}
              {hasTimelines && <TimelinesSection timelines={timelines} onNewTimeline={openNewTimeline} />}

              {/* Entities, an opt-in disclosure. */}
              <EntitiesDisclosure entities={entities} />
            </div>
          )}
        </div>
      </main>

      <NewTimelineDialog open={newTimelineOpen} onOpenChange={setNewTimelineOpen} />
      <NewStoryDialog
        open={!!create}
        mode={create?.mode ?? 'story'}
        initialTitle={create?.title ?? ''}
        initialTopic={create?.topic ?? ''}
        onOpenChange={(o) => {
          if (!o) setCreate(null)
        }}
      />
      <BrandLibraryDialog
        open={!!brandDialog}
        onOpenChange={(o) => {
          if (!o) setBrandDialog(null)
        }}
        initialEditId={brandDialog?.editId ?? null}
        autoCreate={brandDialog?.create ?? false}
      />
    </div>
  )
}

// Brand kits as a home row (ADR-0007 fork #4): the identity layer surfaced beside
// stories/series, not buried in a settings dropdown. Each card opens the kit's editor;
// the header action creates a new one. Both routes share the BrandLibraryDialog.
function BrandKitsSection({
  brands,
  defaultBrandId,
  onOpen,
  onNew,
}: {
  brands: BrandSummary[]
  defaultBrandId: string | null
  onOpen: (brandId: string) => void
  onNew: () => void
}) {
  return (
    <section className="ch-row" aria-label="Brand kits">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Brand kits</h2>
        <div className="ch-row-head-actions">
          <button type="button" className="ch-chip-new" onClick={onNew}>
            <Plus className="size-3.5" />
            New brand
          </button>
        </div>
      </header>
      {brands.length === 0 ? (
        <p className="ch-row-empty">No brand kits yet — create one to dress your stories and series on-brand.</p>
      ) : (
        <div className="ch-brand-grid">
          {brands.map((b) => (
            <BrandKitCard key={b.id} brand={b} isDefault={b.id === defaultBrandId} onOpen={() => onOpen(b.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function BrandKitCard({ brand, isDefault, onOpen }: { brand: BrandSummary; isDefault: boolean; onOpen: () => void }) {
  const swatches = (brand.kit?.colors ?? []).filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 5)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
      aria-label={`Edit brand kit ${brand.name}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Palette className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{brand.name}</span>
        {isDefault && (
          <Badge variant="secondary" className="rounded-full">
            Default
          </Badge>
        )}
      </span>
      {swatches.length > 0 ? (
        <span className="flex items-center gap-1" aria-hidden="true">
          {swatches.map((c, i) => (
            <span key={i} className="size-3.5 rounded-full ring-1 ring-inset ring-foreground/15" style={{ background: c }} />
          ))}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{brand.kit ? 'No palette yet' : 'Empty kit'}</span>
      )}
    </button>
  )
}

// The populated home's cinematic banner: the owner's most-recently-updated story,
// shown reduced-height (~40vh) above the Create bar so the story is the destination
// (Principle 1) and cinematic gravity leads the page (Principle 2). Cover art when the
// story has one, else the branded amber `--color-accent-story` wash. Reuses the hero
// shell the deleted ProjectHero left behind (.ch-hero/.ch-play/…). Play autoplays the
// docked reader; Read opens it on the cover.
function FeaturedHero({ story }: { story: HomeStoryCard }) {
  const { play, continueWriting } = useStoryActions(story, null, 'featured-hero')
  const cover = story.coverImage
  const cast = story.castNames.slice(0, 4)
  const meta = [
    story.beatCount > 0 ? `${story.beatCount} ${story.beatCount === 1 ? 'beat' : 'beats'}` : null,
    story.estimatedMinutes ? `${story.estimatedMinutes} min read` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="ch-hero" data-featured data-wash={cover ? undefined : true} aria-label={`Featured story: ${story.title}`}>
      {cover && (
        <>
          <img className="ch-hero-img" src={cover.url} alt={cover.alt ?? ''} width={1200} height={480} fetchPriority="high" />
          <div className="ch-hero-scrim" aria-hidden="true" />
        </>
      )}
      <div className="ch-hero-body">
        {/* When the featured story is a series chapter, the eyebrow becomes the
            chapter badge (slice E) — "Chapter N · {series}" — surfacing the latest
            series at the top of the home. */}
        <p className="ch-hero-eyebrow">
          {story.series ? (
            <>
              <span>{story.chapterNumber != null ? `Chapter ${story.chapterNumber}` : 'Latest chapter'}</span>
              <span className="ch-sep" aria-hidden="true">
                ·
              </span>
              <span>{story.series.title}</span>
            </>
          ) : (
            <>
              <span>Featured story</span>
              <span className="ch-sep" aria-hidden="true">
                ·
              </span>
              <span>{story.timelineTitle}</span>
            </>
          )}
        </p>
        <h1 className="ch-hero-title">{story.title}</h1>
        {story.hook && <p className="ch-hero-hook">{story.hook}</p>}
        {cast.length > 0 && (
          <div className="ch-hero-cast">
            {cast.map((name) => (
              <span key={name} className="ch-hero-castchip">
                {name}
              </span>
            ))}
          </div>
        )}
        {meta && <p className="ch-hero-meta">{meta}</p>}
        <div className="ch-hero-actions">
          <button type="button" className="ch-play" onClick={play}>
            <Play aria-hidden="true" />
            Play
          </button>
          <button type="button" className="ch-secondary" onClick={continueWriting}>
            <BookOpenText aria-hidden="true" />
            Read
          </button>
          {story.series && (
            <Link to="/series/$id" params={{ id: story.series.id }} className="ch-secondary">
              <Layers aria-hidden="true" />
              View series
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

// The page-level create bar — the populated home's entry point to making a story,
// series, or bare timeline (the empty state owns the brand-new case).
function LibraryActions({
  onStart,
  onNewTimeline,
}: {
  onStart: (mode: CreateMode) => void
  onNewTimeline: () => void
}) {
  return (
    <section className="ch-row" aria-label="Create">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Create</h2>
        <div className="ch-row-head-actions">
          <button type="button" className="ch-chip-new" onClick={() => onStart('story')}>
            <BookOpen className="size-3.5" />
            New story
          </button>
          <button type="button" className="ch-chip-new" onClick={() => onStart('series')}>
            <Layers className="size-3.5" />
            New series
          </button>
          <button type="button" className="ch-chip-new" onClick={onNewTimeline}>
            <Plus className="size-3.5" />
            New timeline
          </button>
        </div>
      </header>
    </section>
  )
}

// All timelines as a wrapping grid (the substrate beneath stories).
function TimelinesSection({ timelines, onNewTimeline }: { timelines: TimelineSummary[]; onNewTimeline: () => void }) {
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
      <div className="ch-proj-grid">
        {timelines.map((t) => (
          <TimelineCard key={t.id} timeline={t} />
        ))}
      </div>
    </section>
  )
}

// Series — the serialized seasons, as a wrapping grid of season posters.
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

// The time-sorted "what changed" feed (stories + timelines) as unified poster cards.
function RecentlyUpdatedSection({ items }: { items: RecentItem[] }) {
  return (
    <section className="ch-row" aria-label="Recently updated">
      <header className="ch-row-head">
        <h2 className="ch-row-title">Recently updated</h2>
      </header>
      <div className="ch-recent-grid">
        {items.map((it) => (
          <RecentCard key={`${it.kind}:${it.id}`} item={it} />
        ))}
      </div>
    </section>
  )
}
