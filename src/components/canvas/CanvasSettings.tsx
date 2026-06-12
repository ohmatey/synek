import { useState, type ReactNode } from 'react'
import { useReactFlow, useStore, useViewport } from '@xyflow/react'
import { Check, Loader2, Minus, Plus, SlidersHorizontal, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Switch } from '~/components/ui/switch'
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
import {
  NARRATION_PITCH_RANGE,
  NARRATION_RATE_RANGE,
  speakNarrationSample,
  useNarrationPrefs,
  useNarrationVoices,
  useSpeechSupported,
} from './useStoryNarration'

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
// actually present in the timeline get a row. (Merged in from the old toolbar
// FilterMenu so the whole canvas view lives in one popover.)
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

// Uniform section header for the view-settings popover — every group (time
// scale, kind filters) reads the same: an uppercase muted label with an
// optional right-aligned aside (the live readout, a "Show all" reset, …).
function SectionHeader({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-5 items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>
      {aside}
    </div>
  )
}

// Floating "view settings" menu → popover. One home for the canvas view: the
// time-axis zoom (compress/expand, timespan presets, gap-collapsing), which node
// kinds show on the timeline, live updates, narration, and — for the owner — a
// "save as default" that persists the current scale. Lives outside <ReactFlow>
// but inside <ReactFlowProvider>, so useReactFlow / useStore reach the live
// viewport for keep-center re-anchoring and the readout.
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
  speak,
  onSpeak,
  kindCounts,
  hiddenKinds,
  onToggleKind,
  onResetKinds,
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
  speak: boolean
  onSpeak: (next: boolean) => void
  kindCounts: Map<string, number>
  hiddenKinds: Set<string>
  onToggleKind: (token: string) => void
  onResetKinds: () => void
}) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)
  const { zoom } = useViewport()
  const [saving, setSaving] = useState(false)
  const speechSupported = useSpeechSupported()
  const [narration, setNarration] = useNarrationPrefs()
  const voices = useNarrationVoices()
  // Fall back to "Auto" when the saved voice isn't available on this device.
  const selectedVoiceURI =
    narration.voiceURI && voices.some((v) => v.voiceURI === narration.voiceURI) ? narration.voiceURI : ''

  // Only kinds actually present get a filter row; hidden count flags the trigger.
  const presentKinds = KIND_META.filter((k) => (kindCounts.get(k.token) ?? 0) > 0)
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
      saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh, speak, chosen: true })
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
          className={cn('relative size-8', floatChip)}
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
          {/* Time scale — zoom level (years across the screen) with −/+ and presets. */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              aside={
                spanYears != null && (
                  <span
                    className="tabular-nums text-xs text-muted-foreground"
                    data-testid="time-scale-level"
                  >
                    {formatSpan(spanYears)} on screen
                  </span>
                )
              }
            >
              Time scale
            </SectionHeader>
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

          {/* Show on timeline — which node kinds render (merged from the old
              toolbar FilterMenu). Multi-select checkboxes; the menu stays open. */}
          {presentKinds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <SectionHeader
                aside={
                  hiddenCount > 0 && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm text-xs font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={onResetKinds}
                    >
                      Show all
                    </button>
                  )
                }
              >
                Show on timeline
              </SectionHeader>
              <div className="flex flex-col gap-0.5">
                {presentKinds.map((k) => {
                  const visible = !hiddenKinds.has(k.token)
                  return (
                    <button
                      key={k.token}
                      type="button"
                      role="checkbox"
                      aria-checked={visible}
                      data-testid={`filter-kind-${k.token}`}
                      onClick={() => onToggleKind(k.token)}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                          visible ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {visible && <Check className="size-3" />}
                      </span>
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: k.color }}
                        aria-hidden
                      />
                      <span className="flex-1 text-left">{k.label}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {kindCounts.get(k.token) ?? 0}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Toggles — live updates + (when supported) narration. Both are plain
              switch rows; the narration config only appears once it's enabled. */}
          <div className="flex flex-col">
            <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
              <span
                className="flex-1"
                title="Stream changes from your MCP client in near-real-time (no page reload)"
              >
                Live updates
              </span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={onAutoRefresh}
                data-testid="auto-refresh-toggle"
                aria-label="Live updates"
              />
            </label>

            {speechSupported && (
              <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
                <span
                  className="flex-1"
                  title="Read stories aloud as the reader plays each beat (browser speech)"
                >
                  Read stories aloud
                </span>
                <Switch
                  checked={speak}
                  onCheckedChange={onSpeak}
                  data-testid="speak-stories-toggle"
                  aria-label="Read stories aloud"
                />
              </label>
            )}

            {/* Narration config — voice / speed / pitch / preview. Device-global
                (available voices differ per machine), so it persists separately
                from the per-timeline view. Only shown while narration is on. */}
            {speechSupported && speak && (
              <div className="mt-1 flex flex-col gap-3 border-l border-border pl-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Voice</span>
                  <select
                    className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-sm"
                    value={selectedVoiceURI}
                    onChange={(e) => setNarration({ voiceURI: e.target.value || null })}
                    data-testid="narration-voice"
                    aria-label="Narration voice"
                  >
                    <option value="">Auto (recommended)</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} — {v.lang}
                        {v.localService ? '' : ' (online)'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Speed</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {narration.rate.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={NARRATION_RATE_RANGE.min}
                    max={NARRATION_RATE_RANGE.max}
                    step={NARRATION_RATE_RANGE.step}
                    value={narration.rate}
                    onChange={(e) => setNarration({ rate: Number(e.target.value) })}
                    className="w-full accent-primary"
                    data-testid="narration-rate"
                    aria-label="Narration speed"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Pitch</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {narration.pitch.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={NARRATION_PITCH_RANGE.min}
                    max={NARRATION_PITCH_RANGE.max}
                    step={NARRATION_PITCH_RANGE.step}
                    value={narration.pitch}
                    onChange={(e) => setNarration({ pitch: Number(e.target.value) })}
                    className="w-full accent-primary"
                    data-testid="narration-pitch"
                    aria-label="Narration pitch"
                  />
                </label>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 justify-center text-xs"
                  onClick={() => speakNarrationSample(narration)}
                  data-testid="narration-preview"
                  title="Hear a sample with these settings"
                >
                  <Volume2 />
                  Preview voice
                </Button>
              </div>
            )}
          </div>

          {isOwner && (
            <div className="flex flex-col gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Save the current scale as this timeline’s default — applied whenever it’s opened on a
                fresh device.
              </p>
              <Button
                variant="default"
                size="sm"
                className="w-full"
                onClick={saveDefault}
                disabled={saving}
              >
                {saving && <Loader2 className="animate-spin" />}
                Save as default
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
