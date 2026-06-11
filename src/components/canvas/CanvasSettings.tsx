import { useState } from 'react'
import { useReactFlow, useStore, useViewport } from '@xyflow/react'
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
const DAYS_PER_YEAR = 365.25

// Timespan presets: roughly how much time should fill the screen. The `years`
// IS the zoom level we surface (years across the screen).
const PRESETS: { label: string; years: number }[] = [
  { label: 'Decade', years: 10 },
  { label: 'Century', years: 100 },
  { label: 'Millennium', years: 1000 },
]

// All filterable kinds, in display order. `token` matches kindToken() in
// TimelineCanvas (entity nodes filter by subtype; type otherwise). Only kinds
// actually present in the timeline get a row.
const KIND_META: { token: string; label: string; color: string }[] = [
  { token: 'period', label: 'Periods', color: 'var(--color-accent-influence)' },
  { token: 'event', label: 'Events', color: 'var(--color-accent-primary)' },
  { token: 'concept', label: 'Concepts', color: 'var(--color-accent-dialogue)' },
  { token: 'person', label: 'People', color: 'var(--color-fg-secondary)' },
  { token: 'org', label: 'Orgs', color: 'var(--color-fg-secondary)' },
  { token: 'place', label: 'Places', color: 'var(--color-fg-secondary)' },
  { token: 'work', label: 'Works', color: 'var(--color-fg-secondary)' },
  { token: 'entity', label: 'Entities', color: 'var(--color-fg-secondary)' },
]

// Human label for a "zoom level" expressed as the timespan visible on screen.
function formatSpan(years: number): string {
  if (years >= 1000) {
    const k = years / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)} kyr`
  }
  if (years >= 1) return `${Math.round(years)} yr`
  return `${Math.max(1, Math.round(years * 12))} mo`
}

// Floating "view settings" menu → popover. One home for the canvas view: which
// node kinds show on the timeline, the time-axis zoom (compress/expand, timespan
// presets, gap-collapsing), live updates, and — for the owner — a "save as
// default" that persists the current scale. Lives outside <ReactFlow> but inside
// <ReactFlowProvider>, so useReactFlow / useStore reach the live viewport for
// keep-center re-anchoring and the zoom readout.
export function CanvasSettings({
  timelineId,
  isOwner,
  pxPerDay,
  collapseGaps,
  autoRefresh,
  scale,
  buildScale,
  counts,
  hiddenKinds,
  onToggleKind,
  onResetKinds,
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
  counts: Map<string, number>
  hiddenKinds: Set<string>
  onToggleKind: (token: string) => void
  onResetKinds: () => void
  onPxPerDay: (next: number) => void
  onCollapseGaps: (next: boolean) => void
  onAutoRefresh: (next: boolean) => void
}) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)
  const { zoom } = useViewport()
  const [saving, setSaving] = useState(false)

  const present = KIND_META.filter((k) => (counts.get(k.token) ?? 0) > 0)
  const hiddenCount = hiddenKinds.size

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

  // Current zoom level = the timespan that fits across the screen at this scale.
  const spanYears = width && zoom ? width / zoom / (pxPerDay * DAYS_PER_YEAR) : null

  async function saveDefault() {
    if (saving) return
    setSaving(true)
    try {
      await setTimelineView({ data: { id: timelineId, view: { pxPerDay, collapseGaps } } })
      saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh, chosen: true })
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
          className={cn(
            'relative size-8',
            floatChip,
            hiddenCount > 0 && 'text-amber-600 dark:text-amber-400',
          )}
          title="View settings"
          aria-label="View settings"
          data-testid="canvas-settings"
        >
          <SlidersHorizontal />
          {hiddenCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
              {hiddenCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-4">
          {/* Show on timeline — per-kind visibility (merged from the old filter chip). */}
          {present.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Show on timeline
                </span>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                    onClick={onResetKinds}
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {present.map((k) => {
                  const visible = !hiddenKinds.has(k.token)
                  return (
                    <label
                      key={k.token}
                      className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2 text-sm transition-colors hover:bg-accent/50"
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => onToggleKind(k.token)}
                        className="size-4 shrink-0 accent-primary"
                        data-testid={`filter-kind-${k.token}`}
                        aria-label={`Show ${k.label} on the timeline`}
                      />
                      <span className={cn('flex flex-1 items-center gap-2', !visible && 'opacity-50')}>
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: k.color }}
                          aria-hidden
                        />
                        <span className="flex-1">{k.label}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {counts.get(k.token) ?? 0}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {present.length > 0 && <Separator />}

          {/* Time scale — zoom level (years across the screen) with −/+ and presets. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Time scale
              </span>
              {spanYears != null && (
                <span className="tabular-nums text-xs text-muted-foreground" data-testid="time-scale-level">
                  {formatSpan(spanYears)} on screen
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                data-testid="time-scale-compress"
                onClick={() => apply(pxPerDay / STEP, collapseGaps)}
                disabled={atMin}
                title="Zoom out — more time on screen"
                aria-label="Zoom out"
              >
                <Minus />
              </Button>
              <div className="flex flex-1 gap-1">
                {PRESETS.map((p) => {
                  const target = presetTarget(p.years)
                  const active = isActive(target)
                  return (
                    <Button
                      key={p.label}
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      className="h-auto flex-1 flex-col gap-0 px-1 py-1 text-xs"
                      data-testid={`time-scale-preset-${p.label.toLowerCase()}`}
                      onClick={() => apply(target, collapseGaps)}
                      title={`Fit about a ${p.label.toLowerCase()} (${formatSpan(p.years)}) across the screen`}
                    >
                      <span>{p.label}</span>
                      <span
                        className={cn(
                          'text-[10px] tabular-nums',
                          active ? 'opacity-80' : 'text-muted-foreground',
                        )}
                      >
                        {formatSpan(p.years)}
                      </span>
                    </Button>
                  )
                })}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                data-testid="time-scale-expand"
                onClick={() => apply(pxPerDay * STEP, collapseGaps)}
                disabled={atMax}
                title="Zoom in — less time on screen"
                aria-label="Zoom in"
              >
                <Plus />
              </Button>
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
              title="Stream changes from your MCP client in near-real-time (no page reload)"
            >
              <RefreshCw className={autoRefresh ? 'animate-none' : undefined} />
              Live updates {autoRefresh ? 'on' : 'off'}
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
