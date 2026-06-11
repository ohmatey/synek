import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Globe, Link2, Loader2, Lock, Share2 } from 'lucide-react'
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
import { setTimelineVisibility } from '~/lib/server/timelines'
import { slugify, toJSON, toMarkdown, toSVG } from '~/lib/domain/export'
import type { TimelineGraph } from '~/lib/domain/types'
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

  useEffect(() => setPub(isPublic), [isPublic])

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
      void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      void qc.invalidateQueries({ queryKey: ['timelines'] })
    } finally {
      setBusy(false)
    }
  }

  function runExport(format: FormatId) {
    if (format === 'json') download(`${slug}.json`, toJSON(graph), 'application/json')
    else if (format === 'markdown') download(`${slug}.md`, toMarkdown(graph), 'text/markdown')
    else if (format === 'svg') download(`${slug}.svg`, toSVG(graph), 'image/svg+xml')
    else if (format === 'png') downloadPng(toSVG(graph), `${slug}.png`)
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
