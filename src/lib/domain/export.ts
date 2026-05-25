import { formatInstant } from './dates'
import type { TimelineGraph } from './types'

// Pure transforms — the canvas is the output, so let people take it with them.
// No DOM/DB here; the UI just wraps these in a download.

export function toJSON(graph: TimelineGraph): string {
  return JSON.stringify(
    {
      title: graph.title,
      exportedAt: new Date().toISOString(),
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        summary: n.summary,
        date: formatInstant(n.startInstant, n.precision),
        startInstant: n.startInstant,
        endInstant: n.endInstant,
        precision: n.precision,
        citations: n.citations,
      })),
      edges: graph.edges.map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId, kind: e.kind, label: e.label })),
    },
    null,
    2,
  )
}

export function toMarkdown(graph: TimelineGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const ordered = [...graph.nodes].sort((a, b) => a.startInstant - b.startInstant)
  const lines: string[] = [`# ${graph.title}`, '', '## Timeline', '']

  for (const n of ordered) {
    const start = formatInstant(n.startInstant, n.precision)
    const date = n.endInstant != null ? `${start}–${formatInstant(n.endInstant, n.precision)}` : start
    lines.push(`- **${date}** — ${n.title} _(${n.type})_`)
    if (n.summary) lines.push(`  ${n.summary}`)
    if (n.citations.length) {
      const cites = n.citations.map((c) => (c.url ? `[${c.title}](${c.url})` : c.title)).join('; ')
      lines.push(`  Sources: ${cites}`)
    }
  }

  if (graph.edges.length) {
    lines.push('', '## Relationships', '')
    for (const e of graph.edges) {
      const source = byId.get(e.sourceId)?.title ?? e.sourceId
      const target = byId.get(e.targetId)?.title ?? e.targetId
      lines.push(`- ${source} — ${e.label ?? e.kind} → ${target}`)
    }
  }

  return lines.join('\n') + '\n'
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'timeline'
  )
}

const XML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }
export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => XML_ESCAPES[c]!)
}

const KIND_COLOR: Record<string, string> = {
  caused: '#e0a458',
  succeeded: '#6aa9ff',
  influenced: '#9b8cff',
  acquired: '#ff6a8b',
  competed_with: '#52c41a',
}
const TYPE_COLOR: Record<string, string> = { period: '#9b8cff', entity: '#3f5168', event: '#3a6df0' }

function yearLabel(year: number): string {
  return year <= 0 ? `${-year + 1} BCE` : `${year}`
}

// Render the timeline as a standalone, dep-free SVG (used directly for SVG
// export, and rasterized to PNG in the browser). Only native shapes/text — no
// foreignObject/external refs — so a <canvas> drawing it isn't tainted.
export function toSVG(graph: TimelineGraph): string {
  const W = 1200
  const padX = 60
  const padTop = 50
  const laneH = 110
  const boxW = 150
  const boxH = 30
  const rowGap = 40
  const laneIndex: Record<string, number> = { period: 0, entity: 1, event: 2 }
  const title = escapeXml(graph.title)

  if (graph.nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="120" viewBox="0 0 ${W} 120"><rect width="100%" height="100%" fill="#0f1115"/><text x="${W / 2}" y="64" fill="#7c8190" font-family="sans-serif" font-size="14" text-anchor="middle">${title} — empty timeline</text></svg>`
  }

  const min = Math.min(...graph.nodes.map((n) => n.startInstant))
  const max = Math.max(...graph.nodes.map((n) => n.endInstant ?? n.startInstant))
  const span = Math.max(1, max - min)
  const xOf = (inst: number) => padX + ((inst - min) / span) * (W - 2 * padX)

  // Light per-lane row packing so same-date nodes don't stack exactly.
  const pos = new Map<string, { x: number; y: number }>()
  const laneRows: Record<number, number[]> = { 0: [], 1: [], 2: [] }
  let maxY = 0
  for (const n of [...graph.nodes].sort((a, b) => a.startInstant - b.startInstant)) {
    const lane = laneIndex[n.type] ?? 2
    const nx = xOf(n.startInstant)
    const rows = laneRows[lane]!
    let row = rows.findIndex((right) => nx >= right)
    if (row === -1) {
      row = rows.length
      rows.push(0)
    }
    rows[row] = nx + boxW + 12
    const y = padTop + lane * laneH + 24 + row * rowGap
    pos.set(n.id, { x: nx, y })
    maxY = Math.max(maxY, y)
  }

  const H = Math.max(240, maxY + 60)
  const axisY = H - 18

  const edgeSvg = graph.edges
    .map((e) => {
      const s = pos.get(e.sourceId)
      const t = pos.get(e.targetId)
      if (!s || !t) return ''
      const color = KIND_COLOR[e.kind] ?? '#6aa9ff'
      return `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.8" marker-end="url(#sf-arrow)"/>`
    })
    .join('')

  const nodeSvg = graph.nodes
    .map((n) => {
      const p = pos.get(n.id)!
      const color = TYPE_COLOR[n.type] ?? '#3a6df0'
      const label = escapeXml(n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title)
      const date = escapeXml(formatInstant(n.startInstant, n.precision))
      const rx = (p.x - boxW / 2).toFixed(1)
      const ry = (p.y - boxH / 2).toFixed(1)
      return `<g><rect x="${rx}" y="${ry}" width="${boxW}" height="${boxH}" rx="6" fill="#1b2230" stroke="${color}"/><text x="${p.x.toFixed(1)}" y="${(p.y - 1).toFixed(1)}" fill="#dfe6f5" font-family="sans-serif" font-size="11" text-anchor="middle">${label}</text><text x="${p.x.toFixed(1)}" y="${(p.y + 11).toFixed(1)}" fill="#8b93a7" font-family="sans-serif" font-size="8" text-anchor="middle">${date}</text></g>`
    })
    .join('')

  const minYear = new Date(min).getUTCFullYear()
  const maxYear = new Date(max).getUTCFullYear()
  const yearSpan = Math.max(1, maxYear - minYear)
  const step = yearSpan > 200 ? 50 : yearSpan > 80 ? 20 : yearSpan > 30 ? 10 : yearSpan > 12 ? 5 : 1
  const ticks: string[] = []
  for (let yr = Math.ceil(minYear / step) * step; yr <= maxYear; yr += step) {
    const d = new Date(Date.UTC(2000, 0, 1))
    d.setUTCFullYear(yr)
    const tx = xOf(d.getTime()).toFixed(1)
    ticks.push(
      `<line x1="${tx}" y1="${axisY - 5}" x2="${tx}" y2="${axisY}" stroke="#3a3f4c"/><text x="${tx}" y="${axisY + 12}" fill="#7c8190" font-family="sans-serif" font-size="9" text-anchor="middle">${yearLabel(yr)}</text>`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><marker id="sf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#6aa9ff"/></marker></defs>
<rect width="100%" height="100%" fill="#0f1115"/>
<text x="${padX}" y="28" fill="#e7e9ee" font-family="sans-serif" font-size="16" font-weight="700">${title}</text>
${edgeSvg}${nodeSvg}${ticks.join('')}
</svg>`
}
