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

export function ExportControls({ graph }: { graph: TimelineGraph }) {
  if (graph.nodes.length === 0) return null
  const slug = slugify(graph.title)
  return (
    <div className="export-controls">
      <button type="button" title="Download as JSON" onClick={() => download(`${slug}.json`, toJSON(graph), 'application/json')}>
        JSON
      </button>
      <button type="button" title="Download as Markdown" onClick={() => download(`${slug}.md`, toMarkdown(graph), 'text/markdown')}>
        Markdown
      </button>
      <button type="button" title="Download as SVG" onClick={() => download(`${slug}.svg`, toSVG(graph), 'image/svg+xml')}>
        SVG
      </button>
      <button type="button" title="Download as PNG" onClick={() => downloadPng(toSVG(graph), `${slug}.png`)}>
        PNG
      </button>
    </div>
  )
}
