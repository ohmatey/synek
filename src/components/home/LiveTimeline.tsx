// A decorative "live timeline" motif for the landing hero — a mini canvas that
// builds itself the way an MCP client builds a real Synek timeline. Pure
// CSS/SVG, no React Flow. Coordinates live in a 320×160 space (matches the
// stage's 16:8 ratio) so the SVG edges and the HTML node chips stay aligned.

const VB_W = 320
const VB_H = 160

type Kind = 'event' | 'entity' | 'period'

interface Node {
  id: string
  x: number
  y: number
  label: string
  kind: Kind
  dot?: string
  delay: number
}

interface Tick {
  x: number
  label: string
}

interface PreviewData {
  nodes: Node[]
  edges: Array<[string, string]>
  ticks: Tick[]
}

export type PreviewKey = 'cloud' | 'greek' | 'biz'

export const PREVIEWS: { key: PreviewKey; label: string }[] = [
  { key: 'cloud', label: 'Cloud-native era' },
  { key: 'greek', label: 'Greek history' },
  { key: 'biz', label: 'Competitor moves' },
]

const EVENT = 'var(--color-accent-primary)'
const ENTITY = 'var(--color-accent-dialogue)'
const NOW = 'var(--color-accent-story)'

const DATA: Record<PreviewKey, PreviewData> = {
  cloud: {
    nodes: [
      { id: 'a', x: 30, y: 98, label: '1968 · First trace', kind: 'event', dot: EVENT, delay: 120 },
      { id: 'b', x: 104, y: 66, label: 'Datadog', kind: 'entity', dot: ENTITY, delay: 300 },
      { id: 'p', x: 150, y: 34, label: 'Cloud-native era', kind: 'period', delay: 470 },
      { id: 'c', x: 176, y: 104, label: '2015 · Tracing', kind: 'event', dot: EVENT, delay: 620 },
      { id: 'd', x: 240, y: 70, label: 'OpenTelemetry', kind: 'entity', dot: ENTITY, delay: 800 },
      { id: 'e', x: 296, y: 100, label: 'Today', kind: 'event', dot: NOW, delay: 980 },
    ],
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['b', 'p'],
    ],
    ticks: [
      { x: 30, label: "'68" },
      { x: 120, label: "'95" },
      { x: 210, label: "'15" },
      { x: 296, label: 'now' },
    ],
  },
  greek: {
    nodes: [
      { id: 'a', x: 28, y: 98, label: 'Homer · 750 BC', kind: 'event', dot: EVENT, delay: 120 },
      { id: 'b', x: 100, y: 66, label: 'Athens', kind: 'entity', dot: ENTITY, delay: 300 },
      { id: 'p', x: 150, y: 34, label: 'Classical era', kind: 'period', delay: 470 },
      { id: 'c', x: 176, y: 104, label: 'Socrates', kind: 'entity', dot: ENTITY, delay: 620 },
      { id: 'd', x: 240, y: 70, label: 'Alexander · 336 BC', kind: 'event', dot: EVENT, delay: 800 },
      { id: 'e', x: 296, y: 100, label: 'Hellenistic', kind: 'event', dot: NOW, delay: 980 },
    ],
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['b', 'p'],
    ],
    ticks: [
      { x: 28, label: '750BC' },
      { x: 120, label: '500BC' },
      { x: 210, label: '300BC' },
      { x: 296, label: '30BC' },
    ],
  },
  biz: {
    nodes: [
      { id: 'a', x: 30, y: 98, label: 'Netflix · 1997', kind: 'event', dot: EVENT, delay: 120 },
      { id: 'b', x: 100, y: 66, label: 'Blockbuster', kind: 'entity', dot: ENTITY, delay: 300 },
      { id: 'p', x: 150, y: 34, label: 'Streaming era', kind: 'period', delay: 470 },
      { id: 'c', x: 176, y: 104, label: '2007 · Streaming', kind: 'event', dot: EVENT, delay: 620 },
      { id: 'd', x: 240, y: 70, label: 'Disney+', kind: 'entity', dot: ENTITY, delay: 800 },
      { id: 'e', x: 296, y: 100, label: 'Today', kind: 'event', dot: NOW, delay: 980 },
    ],
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['a', 'p'],
    ],
    ticks: [
      { x: 30, label: "'97" },
      { x: 120, label: "'07" },
      { x: 210, label: "'19" },
      { x: 296, label: 'now' },
    ],
  },
}

export function LiveTimeline({ preview }: { preview: PreviewKey }) {
  const { nodes, edges, ticks } = DATA[preview]
  const byId = (id: string) => nodes.find((n) => n.id === id)!

  return (
    <div className="lp-stage lp-anim" aria-hidden>
      <div className="lp-stage-line" />

      {ticks.map((t) => (
        <span key={t.label} className="lp-tick" style={{ left: `${(t.x / VB_W) * 100}%` }}>
          <span>{t.label}</span>
        </span>
      ))}

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        fill="none"
      >
        {edges.map(([a, b]) => {
          const s = byId(a)
          const t = byId(b)
          const len = Math.hypot(t.x - s.x, t.y - s.y) * 1.7
          const midX = (s.x + t.x) / 2
          const d = `M ${s.x} ${s.y} C ${midX} ${s.y}, ${midX} ${t.y}, ${t.x} ${t.y}`
          return (
            <path
              key={`${a}-${b}`}
              className="lp-edge"
              d={d}
              style={
                {
                  '--len': len,
                  '--d': `${Math.max(s.delay, t.delay) + 120}ms`,
                } as React.CSSProperties
              }
            />
          )
        })}
      </svg>

      {nodes.map((n) => (
        <div
          key={n.id}
          className={`lp-node ${n.kind === 'event' ? 'is-event' : ''} ${n.kind === 'period' ? 'is-period' : ''}`}
          style={
            {
              left: `${(n.x / VB_W) * 100}%`,
              top: `${(n.y / VB_H) * 100}%`,
              transform: 'translate(-50%, -50%)',
              '--d': `${n.delay}ms`,
            } as React.CSSProperties
          }
        >
          {n.kind !== 'period' && <span className="lp-dot" style={{ background: n.dot }} />}
          {n.label}
        </div>
      ))}
    </div>
  )
}
