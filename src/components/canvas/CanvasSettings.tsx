import { useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Check, Loader2, Minus, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/utils'
import { setTimelineView } from '~/lib/server/timelines'
import {
  MIN_PX_PER_DAY,
  MAX_PX_PER_DAY,
  pxPerDayForYears,
  saveScalePref,
  type TimeScale,
} from './useTimelineScale'
import { floatChip } from './chrome'

// Multiplicative step so −/+ feel even across scales (compress vs. expand).
const STEP = 1.4

// Timespan presets: roughly how much time should fill the screen.
const PRESETS: { label: string; years: number }[] = [
  { label: 'Decade', years: 10 },
  { label: 'Century', years: 100 },
  { label: 'Millennium', years: 1000 },
]

// Floating "display settings" button → popover. Holds the time-axis scale
// controls (compress/expand, timespan presets, gap-collapsing) and, for the
// owner, a "save as default" that persists the current scale to the timeline.
// Lives outside <ReactFlow> but inside <ReactFlowProvider>, so useReactFlow /
// useStore still reach the live viewport for keep-center re-anchoring.
export function CanvasSettings({
  timelineId,
  isOwner,
  pxPerDay,
  collapseGaps,
  autoRefresh,
  scale,
  buildScale,
  onPxPerDay,
  onCollapseGaps,
  onAutoRefresh,
}: {
  timelineId: string
  isOwner: boolean
  pxPerDay: number
  collapseGaps: boolean
  autoRefresh: boolean
  scale: TimeScale
  buildScale: (pxPerDay: number, collapseGaps: boolean) => TimeScale
  onPxPerDay: (next: number) => void
  onCollapseGaps: (next: boolean) => void
  onAutoRefresh: (next: boolean) => void
}) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)
  const [saving, setSaving] = useState(false)

  const apply = (nextPxPerDay: number, nextCollapse: boolean) => {
    const clamped = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, nextPxPerDay))
    if (clamped === pxPerDay && nextCollapse === collapseGaps) return

    const vp = rf.getViewport()
    if (width && vp.zoom) {
      // Hold the instant currently at screen-center fixed under the new scale.
      const centerWorldX = (width / 2 - vp.x) / vp.zoom
      const centerInstant = scale.toInstant(centerWorldX)
      const nextScale = buildScale(clamped, nextCollapse)
      rf.setViewport({ x: width / 2 - nextScale.toX(centerInstant) * vp.zoom, y: vp.y, zoom: vp.zoom })
    }
    if (clamped !== pxPerDay) onPxPerDay(clamped)
    if (nextCollapse !== collapseGaps) onCollapseGaps(nextCollapse)
  }

  const presetTarget = (years: number) => pxPerDayForYears(years, (width || 1) / (rf.getZoom() || 1))
  const isActive = (target: number) => Math.abs(pxPerDay / target - 1) < 0.02
  const atMin = pxPerDay <= MIN_PX_PER_DAY * 1.0001
  const atMax = pxPerDay >= MAX_PX_PER_DAY * 0.9999

  async function saveDefault() {
    if (saving) return
    setSaving(true)
    try {
      await setTimelineView({ data: { id: timelineId, view: { pxPerDay, collapseGaps } } })
      saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh })
      toast.success('Saved as this timeline’s default scale')
    } catch {
      toast.error('Couldn’t save the default')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn('size-8', floatChip)}
          title="Display settings"
          aria-label="Display settings"
          data-testid="canvas-settings"
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Time scale
            </span>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  data-testid="time-scale-compress"
                  onClick={() => apply(pxPerDay / STEP, collapseGaps)}
                  disabled={atMin}
                  title="Compress timeline (less scrolling)"
                  aria-label="Compress timeline"
                >
                  <Minus />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  data-testid="time-scale-expand"
                  onClick={() => apply(pxPerDay * STEP, collapseGaps)}
                  disabled={atMax}
                  title="Expand timeline"
                  aria-label="Expand timeline"
                >
                  <Plus />
                </Button>
              </div>
              <div className="flex flex-1 gap-1">
                {PRESETS.map((p) => {
                  const target = presetTarget(p.years)
                  return (
                    <Button
                      key={p.label}
                      variant={isActive(target) ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 flex-1 px-2 text-xs"
                      data-testid={`time-scale-preset-${p.label.toLowerCase()}`}
                      onClick={() => apply(target, collapseGaps)}
                      title={`Fit about a ${p.label.toLowerCase()} across the screen`}
                    >
                      {p.label}
                    </Button>
                  )
                })}
              </div>
            </div>
            <Button
              variant={collapseGaps ? 'default' : 'outline'}
              size="sm"
              className="h-8 justify-center text-xs"
              data-testid="time-scale-collapse-gaps"
              onClick={() => apply(pxPerDay, !collapseGaps)}
              aria-pressed={collapseGaps}
              title="Collapse long empty stretches between dates"
            >
              {collapseGaps && <Check />}
              Collapse long gaps
            </Button>
          </div>

          <Separator />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live updates
            </span>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              className="h-8 justify-center text-xs"
              data-testid="auto-refresh-toggle"
              onClick={() => onAutoRefresh(!autoRefresh)}
              aria-pressed={autoRefresh}
              title="Automatically pick up changes made by your MCP client (no page reload)"
            >
              <RefreshCw className={autoRefresh ? 'animate-none' : undefined} />
              Auto-refresh {autoRefresh ? 'on' : 'off'}
            </Button>
          </div>

          {isOwner && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Save the current scale as this timeline’s default — applied whenever it’s opened on
                  a fresh device.
                </p>
                <Button variant="secondary" size="sm" onClick={saveDefault} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  Save as default
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
