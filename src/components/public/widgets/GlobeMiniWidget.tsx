import { useMemo } from 'react'
import { geoOrthographic, geoPath, geoGraticule10, geoDistance } from 'd3-geo'
import { feature } from 'topojson-client'
import type { FeatureCollection } from 'geojson'
import type { GeometryCollection } from 'topojson-specification'
import world from 'world-atlas/countries-110m.json'
import type { GraphNode } from '~/lib/domain/types'

// A small, static orthographic globe — the `globe` beat widget. Centered on the
// focus place with the located nodes pinned (focus haloed + labelled). Read-only,
// no playback. Default export so it lazy-loads (keeps d3-geo + the world TopoJSON
// out of every other route's bundle). Client-only (ClientOnly wraps it upstream).

const SIZE = 320
const land = feature(
  world,
  world.objects.countries as unknown as GeometryCollection,
) as unknown as FeatureCollection
const graticule = geoGraticule10()

const located = (n: GraphNode) => typeof n.lat === 'number' && typeof n.lng === 'number'

export default function GlobeMiniWidget({ nodes, focusId }: { nodes: GraphNode[]; focusId?: string }) {
  const pins = useMemo(() => nodes.filter(located), [nodes])

  const center = useMemo<[number, number]>(() => {
    const focus = focusId ? pins.find((n) => n.id === focusId) : undefined
    if (focus) return [focus.lng as number, focus.lat as number]
    if (pins.length === 0) return [0, 20]
    const lng = pins.reduce((s, n) => s + (n.lng as number), 0) / pins.length
    const lat = pins.reduce((s, n) => s + (n.lat as number), 0) / pins.length
    return [lng, lat]
  }, [pins, focusId])

  const projection = useMemo(
    () =>
      geoOrthographic()
        .clipAngle(90)
        .rotate([-center[0], -center[1]])
        .translate([SIZE / 2, SIZE / 2])
        .scale(SIZE / 2 - 6),
    [center],
  )

  const { spherePath, gratPath, landPaths } = useMemo(() => {
    const p = geoPath(projection)
    return {
      spherePath: p({ type: 'Sphere' }) ?? '',
      gratPath: p(graticule) ?? '',
      landPaths: land.features.map((f) => p(f) ?? ''),
    }
  }, [projection])

  // Cull back-hemisphere pins (the scalar projection doesn't clip them).
  const markers = useMemo(() => {
    const rot = projection.rotate()
    const c: [number, number] = [-rot[0], -rot[1]]
    const out: { n: GraphNode; x: number; y: number; focus: boolean }[] = []
    for (const n of pins) {
      if (geoDistance([n.lng as number, n.lat as number], c) > Math.PI / 2) continue
      const xy = projection([n.lng as number, n.lat as number])
      if (!xy) continue
      out.push({ n, x: xy[0], y: xy[1], focus: n.id === focusId })
    }
    return out.sort((a, b) => Number(a.focus) - Number(b.focus))
  }, [pins, projection, focusId])

  const focusMarker = markers.find((m) => m.focus)

  return (
    <div className="wg-globe">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="wg-globe-svg" role="img" aria-label="Globe showing this beat's location">
        <defs>
          <radialGradient id="wg-globe-atmo">
            <stop offset="62%" stopColor="var(--color-accent-primary)" stopOpacity="0" />
            <stop offset="86%" stopColor="var(--color-accent-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="wg-globe-atmo" cx={SIZE / 2} cy={SIZE / 2} r={(SIZE / 2 - 6) * 1.16} fill="url(#wg-globe-atmo)" />
        <path className="wg-globe-sphere" d={spherePath} />
        <path className="wg-globe-grat" d={gratPath} />
        {landPaths.map((d, i) => (
          <path key={i} className="wg-globe-land" d={d} />
        ))}
        {markers.map(({ n, x, y, focus }) => (
          <g key={n.id} transform={`translate(${x},${y})`}>
            {focus && <circle className="wg-globe-halo" r={9} />}
            <circle className="wg-globe-pin" data-focus={focus || undefined} r={focus ? 5 : 3} />
          </g>
        ))}
      </svg>
      {focusMarker && <span className="wg-globe-caption">{focusMarker.n.location ?? focusMarker.n.title}</span>}
    </div>
  )
}
