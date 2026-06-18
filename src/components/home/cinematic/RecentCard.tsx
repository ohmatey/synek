import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, Clock, LayoutGrid, MoreHorizontal, Pencil, Play, Share2, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { deleteTimeline, renameTimeline } from '~/lib/server/timelines'
import type { HomeStoryCard, ProjectSummary, TimelineSummary } from '~/lib/domain/types'
import { MoveToProjectSubmenu } from './MoveToProjectSubmenu'
import { useMoveTimeline } from './useMoveTimeline'
import { useStoryActions } from './useStoryActions'
import { hueFromString } from './hue'

// A single entry in the home's "Recently updated" feed — stories and timelines
// share ONE poster shell (unlike the per-type carousels they replace) so the
// time-sorted mix reads as one coherent list of "what changed". The card body is a
// quick-jump (story → docked reader, timeline → canvas); the footer overflow menu
// restores the full per-item actions the old StoryCard/TimelineCard carried.
export type RecentItem =
  | { kind: 'story'; id: string; updatedAt: number; story: HomeStoryCard }
  | { kind: 'timeline'; id: string; updatedAt: number; timeline: TimelineSummary }

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Compact "what changed, when" stamp. Recent edits read as relative ("3h ago");
// anything older than ~a month falls back to an absolute date so the feed stays
// legible without a tooltip.
function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  if (day < 31) return `${Math.round(day / 7)}w ago`
  return dateFmt.format(epochMs)
}

// The shared poster face (cover + body + meta), rendered inside the open-target.
function Poster({
  id,
  title,
  hook,
  cover,
  Icon,
  typeLabel,
  updatedAt,
}: {
  id: string
  title: string
  hook: string | null
  cover: { url: string; alt?: string | null } | null
  Icon: typeof BookOpen
  typeLabel: string
  updatedAt: number
}) {
  return (
    <>
      <span
        className="ch-card-cover"
        data-wash={cover ? undefined : true}
        style={cover ? undefined : ({ '--cover-hue': hueFromString(id) } as React.CSSProperties)}
      >
        {cover ? (
          <img src={cover.url} alt={cover.alt ?? ''} loading="lazy" />
        ) : (
          <span className="ch-card-cover-fallback" aria-hidden="true">
            <Icon />
          </span>
        )}
      </span>
      <span className="ch-card-body">
        <span className="ch-card-title">{title}</span>
        {hook && <span className="ch-card-hook">{hook}</span>}
        <span className="ch-card-meta">
          <span className="ch-recent-kind">{typeLabel}</span>
          <span className="ch-card-dot" aria-hidden="true">
            ·
          </span>
          <time dateTime={new Date(updatedAt).toISOString()}>{relativeTime(updatedAt)}</time>
        </span>
      </span>
    </>
  )
}

const MENU_TRIGGER_CLASS =
  'grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent'

export function RecentCard({
  item,
  projects,
  currentProjectId,
}: {
  item: RecentItem
  projects: ProjectSummary[]
  // The project the item's timeline currently belongs to — for the story Move
  // submenu's "current" marker + undo path. Timelines read their own projectId.
  currentProjectId: string | null
}) {
  return item.kind === 'story' ? (
    <StoryRecent story={item.story} id={item.id} updatedAt={item.updatedAt} projects={projects} currentProjectId={currentProjectId} />
  ) : (
    <TimelineRecent timeline={item.timeline} id={item.id} updatedAt={item.updatedAt} projects={projects} />
  )
}

function StoryRecent({
  story,
  id,
  updatedAt,
  projects,
  currentProjectId,
}: {
  story: HomeStoryCard
  id: string
  updatedAt: number
  projects: ProjectSummary[]
  currentProjectId: string | null
}) {
  const move = useMoveTimeline()
  const { play, continueWriting, openCanvas, share } = useStoryActions(story, currentProjectId, 'card')
  const showMove = projects.length > 1

  return (
    <article className="ch-card">
      <Link
        to="/timelines/$id"
        params={{ id: story.timelineId }}
        search={{ story: story.storyId }}
        className="ch-card-open"
        aria-label={`Open story “${story.title}”`}
      >
        <Poster
          id={id}
          title={story.title}
          hook={story.hook}
          cover={story.coverImage}
          Icon={BookOpen}
          typeLabel="Story"
          updatedAt={updatedAt}
        />
      </Link>
      <div className="ch-card-foot">
        <button type="button" className="ch-card-play" onClick={play}>
          <Play aria-hidden="true" />
          Play
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={MENU_TRIGGER_CLASS} aria-label={`Actions for “${story.title}”`}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={openCanvas}>
              <LayoutGrid />
              Open canvas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={continueWriting}>
              <Pencil />
              Continue writing
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void share()}>
              <Share2 />
              Share
            </DropdownMenuItem>
            {showMove && (
              <>
                <DropdownMenuSeparator />
                <MoveToProjectSubmenu
                  projects={projects}
                  currentProjectId={currentProjectId}
                  onMove={(target) =>
                    void move({
                      timelineId: story.timelineId,
                      fromProjectId: currentProjectId,
                      targetProjectId: target.id,
                      targetProjectTitle: target.title,
                      itemLabel: story.title,
                    })
                  }
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

function TimelineRecent({
  timeline,
  id,
  updatedAt,
  projects,
}: {
  timeline: TimelineSummary
  id: string
  updatedAt: number
  projects: ProjectSummary[]
}) {
  const qc = useQueryClient()
  const move = useMoveTimeline()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(timeline.title)
  const showMove = projects.length > 1

  async function saveRename() {
    const t = draft.trim()
    setEditing(false)
    if (!t || t === timeline.title) return
    await renameTimeline({ data: { id: timeline.id, title: t } })
    await qc.invalidateQueries({ queryKey: ['timelines'] })
  }

  async function remove() {
    if (!window.confirm(`Delete “${timeline.title}” and all its nodes? This can't be undone.`)) return
    await deleteTimeline({ data: timeline.id })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['timelines'] }),
      qc.invalidateQueries({ queryKey: ['home-stories'] }),
    ])
  }

  return (
    <article className="ch-card">
      {editing ? (
        <div className="ch-card-rename">
          <Input
            autoFocus
            className="h-9"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            aria-label="Timeline name"
          />
        </div>
      ) : (
        <Link
          to="/timelines/$id"
          params={{ id: timeline.id }}
          className="ch-card-open"
          aria-label={`Open timeline “${timeline.title}”`}
        >
          <Poster
            id={id}
            title={timeline.title}
            hook={timeline.description}
            cover={null}
            Icon={Clock}
            typeLabel="Timeline"
            updatedAt={updatedAt}
          />
        </Link>
      )}
      <div className="ch-card-foot">
        <span className="ch-card-foot-spacer" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={MENU_TRIGGER_CLASS} aria-label={`Actions for “${timeline.title}”`}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={() => {
                setDraft(timeline.title)
                setEditing(true)
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            {showMove && (
              <MoveToProjectSubmenu
                projects={projects}
                currentProjectId={timeline.projectId}
                onMove={(target) =>
                  void move({
                    timelineId: timeline.id,
                    fromProjectId: timeline.projectId,
                    targetProjectId: target.id,
                    targetProjectTitle: target.title,
                    itemLabel: timeline.title,
                  })
                }
              />
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
