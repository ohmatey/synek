import { useEffect, useRef, useState } from 'react'
import { toJSON, toMarkdown, toSVG, slugify } from '~/lib/domain/export'
import type { TimelineGraph } from '~/lib/domain/types'

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
      ctx.fillStyle = '#0f1115'
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

export function ExportControls({ graph }: { graph: TimelineGraph }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (graph.nodes.length === 0) return null
  const slug = slugify(graph.title)

  function run(format: (typeof FORMATS)[number]['id']) {
    setOpen(false)
    if (format === 'json') download(`${slug}.json`, toJSON(graph), 'application/json')
    else if (format === 'markdown') download(`${slug}.md`, toMarkdown(graph), 'text/markdown')
    else if (format === 'svg') download(`${slug}.svg`, toSVG(graph), 'image/svg+xml')
    else if (format === 'png') downloadPng(toSVG(graph), `${slug}.png`)
  }

  return (
    <div className="export-controls" ref={ref}>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Export timeline"
      >
        Export ▾
      </button>
      {open && (
        <div className="export-menu" role="menu">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" className="export-menu-item" role="menuitem" onClick={() => run(f.id)}>
              <span className="export-menu-label">{f.label}</span>
              <span className="export-menu-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
