import { ChevronDown, Download } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'
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

export function ExportControls({ graph }: { graph: TimelineGraph }) {
  if (graph.nodes.length === 0) return null
  const slug = slugify(graph.title)

  function run(format: FormatId) {
    if (format === 'json') download(`${slug}.json`, toJSON(graph), 'application/json')
    else if (format === 'markdown') download(`${slug}.md`, toMarkdown(graph), 'text/markdown')
    else if (format === 'svg') download(`${slug}.svg`, toSVG(graph), 'image/svg+xml')
    else if (format === 'png') downloadPng(toSVG(graph), `${slug}.png`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(floatChip, 'h-8')} title="Export timeline">
          <Download />
          Export
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => run(f.id)} className="flex-col items-start gap-0.5">
            <span className="font-medium">{f.label}</span>
            <span className="text-xs text-muted-foreground">{f.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
