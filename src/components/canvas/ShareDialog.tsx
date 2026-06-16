import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Download, Globe, Link2, Loader2, Lock, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/utils'
import { CopyButton } from '~/components/home/CopyButton'
import { capture } from '~/lib/posthog/client'
import { setTimelineVisibility } from '~/lib/server/timelines'
import { listStories, setStoryShare } from '~/lib/server/stories'
import { slugify, toJSON, toMarkdown, toSVG } from '~/lib/domain/export'
import type { StoryListItem, TimelineGraph } from '~/lib/domain/types'
import { floatChip } from './chrome'

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Read a CSS variable from <html> at call time — picks up the live theme,
// so PNG exports get a light bg in light mode and dark in dark mode.
function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

// Rasterize the (untainted) SVG to PNG via an <img> + <canvas>.
function downloadPng(svg: string, filename: string) {
  const sized = /width="(\d+)"[^>]*height="(\d+)"/.exec(svg)
  const w = sized ? Number(sized[1]) : 1200
  const h = sized ? Number(sized[2]) : 400
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = readToken('--color-bg-base', '#0f1115')
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
    }
    URL.revokeObjectURL(url)
    canvas.toBlob((blob) => {
      if (!blob) return
      const pngUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(pngUrl)
    }, 'image/png')
  }
  img.src = url
}

const FORMATS = [
  { id: 'json', label: 'JSON', hint: 'Structured data' },
  { id: 'markdown', label: 'Markdown', hint: 'Readable outline' },
  { id: 'svg', label: 'SVG', hint: 'Vector image' },
  { id: 'png', label: 'PNG', hint: 'Raster image' },
] as const

type FormatId = (typeof FORMATS)[number]['id']

// Notion-style share dialog: public-link sharing (owner only) and export, merged
// into one surface. Lives at the far-right of the canvas top bar, by the account menu.
export function ShareDialog({
  timelineId,
  graph,
  isOwner,
  isPublic,
}: {
  timelineId: string
  graph: TimelineGraph
  isOwner: boolean
  isPublic: boolean
}) {
  const qc = useQueryClient()
  const [pub, setPub] = useState(isPublic)
  const [busy, setBusy] = useState(false)
  // Which story's public link is currently being minted (per-row spinner).
  const [storyBusy, setStoryBusy] = useState<string | null>(null)

  useEffect(() => setPub(isPublic), [isPublic])

  // The timeline's stories, so an owner can publish any one as its own /s/$slug
  // page right here (the share hub). Shares the ['stories', id] cache the canvas
  // already populates, so it's usually a cache hit, not a new request.
  const storiesQuery = useQuery({
    queryKey: ['stories', timelineId],
    queryFn: () => listStories({ data: timelineId }),
    enabled: isOwner,
  })
  const stories = storiesQuery.data ?? []

  const hasNodes = graph.nodes.length > 0
  // Nothing to offer a public viewer of an empty timeline.
  if (!isOwner && !hasNodes) return null

  const slug = slugify(graph.title)
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/timelines/${timelineId}` : ''

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const next = !pub
      await setTimelineVisibility({ data: { id: timelineId, isPublic: next } })
      setPub(next)
      capture('share_toggled', { timeline_id: timelineId, public: next })
      void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      void qc.invalidateQueries({ queryKey: ['timelines'] })
    } finally {
      setBusy(false)
    }
  }

  // Toggle ONE story's public visibility — per-story, INDEPENDENT of the timeline
  // (it does not touch timeline sharing). Optimistic so the switch feels instant;
  // on the publish edge we also copy the fresh /s/$slug link. Resyncs on error.
  async function toggleStoryShare(storyId: string, next: boolean) {
    if (storyBusy) return
    setStoryBusy(storyId)
    qc.setQueryData<StoryListItem[]>(['stories', timelineId], (prev) =>
      prev?.map((s) => (s.storyId === storyId ? { ...s, isPublic: next } : s)),
    )
    try {
      const res = await setStoryShare({ data: { storyId, isPublic: next } })
      if ('error' in res) {
        toast.error('Only the owner can change a story’s sharing.')
        void qc.invalidateQueries({ queryKey: ['stories', timelineId] })
        return
      }
      if (next) {
        const url = `${window.location.origin}/s/${res.slug}`
        await navigator.clipboard.writeText(url)
        capture('story_shared', { story_id: storyId })
        toast.success('Story is public — link copied', { description: url })
      } else {
        toast.success('Story is private again')
      }
    } catch {
      toast.error('Couldn’t update sharing.')
      void qc.invalidateQueries({ queryKey: ['stories', timelineId] })
    } finally {
      setStoryBusy(null)
    }
  }

  function copyStoryLink(slug: string) {
    const url = `${window.location.origin}/s/${slug}`
    void navigator.clipboard.writeText(url)
    toast.success('Public link copied', { description: url })
  }

  function runExport(format: FormatId) {
    if (format === 'json') download(`${slug}.json`, toJSON(graph), 'application/json')
    else if (format === 'markdown') download(`${slug}.md`, toMarkdown(graph), 'text/markdown')
    else if (format === 'svg') download(`${slug}.svg`, toSVG(graph), 'image/svg+xml')
    else if (format === 'png') downloadPng(toSVG(graph), `${slug}.png`)
    capture('export_performed', { timeline_id: timelineId, format })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={cn('h-8', floatChip)}>
          <Share2 />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share timeline</DialogTitle>
          <DialogDescription>Publish a read-only link or export a copy.</DialogDescription>
        </DialogHeader>

        {isOwner && (
          <section className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {pub ? <Globe className="size-4" /> : <Lock className="size-4" />}
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">Anyone with the link can view</span>
                <span className="text-xs text-muted-foreground">
                  Read-only — viewers can’t edit your timeline.
                </span>
              </span>
              {busy ? (
                <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" />
              ) : (
                <input
                  type="checkbox"
                  checked={pub}
                  disabled={busy}
                  onChange={() => void toggle()}
                  className="mt-0.5 size-4 accent-primary"
                />
              )}
            </label>
            {pub && (
              <div className="flex items-center gap-2">
                <span className="flex flex-1 items-center gap-2 truncate rounded-md border border-border bg-background px-2 py-1.5">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <code className="flex-1 truncate font-mono text-xs text-muted-foreground">
                    {shareUrl}
                  </code>
                </span>
                <CopyButton text={shareUrl} variant="outline" />
              </div>
            )}
          </section>
        )}

        {isOwner && stories.length > 0 && <Separator />}

        {isOwner && stories.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="size-4 text-muted-foreground" />
              Share a story
            </div>
            <p className="text-xs text-muted-foreground">
              Publish a single story as its own public page — a focused mobile reader at{' '}
              <code className="font-mono">/s/…</code>. Independent of the timeline above.
            </p>
            <div className="flex max-h-44 flex-col gap-1 overflow-auto">
              {stories.map((s) => (
                <div
                  key={s.storyId}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <span className="flex-1 truncate" title={s.title}>
                    {s.title}
                  </span>
                  {s.isPublic && (
                    <button
                      type="button"
                      onClick={() => copyStoryLink(s.slug)}
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`Copy public link for “${s.title}”`}
                    >
                      <Link2 className="size-3.5" />
                      Copy link
                    </button>
                  )}
                  {storyBusy === s.storyId ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={s.isPublic}
                      onChange={() => void toggleStoryShare(s.storyId, !s.isPublic)}
                      className="size-4 shrink-0 accent-primary"
                      aria-label={s.isPublic ? `Unshare “${s.title}”` : `Share “${s.title}” publicly`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {isOwner && hasNodes && <Separator />}

        {hasNodes && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Download className="size-4 text-muted-foreground" />
              Export
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => runExport(f.id)}
                  className="flex flex-col items-start gap-0.5 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{f.label}</span>
                  <span className="text-xs text-muted-foreground">{f.hint}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
