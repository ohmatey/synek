import { useState } from 'react'
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

// Human label for a "zoom level" expressed as the timespan visible on screen.
function formatSpan(years: number): string {
  if (years >= 1000) {
    const k = years / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)} kyr`
  }
  if (years >= 1) return `${Math.round(years)} yr`
  return `${Math.max(1, Math.round(years * 12))} mo`
}

// Floating "view settings" menu → popover. One home for the canvas view: the
// time-axis zoom (compress/expand, timespan presets, gap-collapsing), live
// updates, narration, and — for the owner — a "save as default" that persists
// the current scale. (Which node kinds show lives in the toolbar FilterMenu.)
// Lives outside <ReactFlow> but inside <ReactFlowProvider>, so useReactFlow /
// useStore reach the live viewport for keep-center re-anchoring and the readout.
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
          className={cn('size-8', floatChip)}
          title="View settings"
          aria-label="View settings"
          data-testid="canvas-settings"
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-4">
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

          <div className="flex flex-col gap-1">
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
          </div>

          {/* Speech — narration on/off + the device's voice / speed / pitch and a
              preview. Voice settings are device-global (available voices differ per
              machine), so they persist separately from the per-timeline view. */}
          {speechSupported && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                <span
                  className="flex-1 font-medium"
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

              <div className={cn('flex flex-col gap-3', !speak && 'pointer-events-none opacity-50')}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Voice</span>
                  <select
                    className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-sm"
                    value={selectedVoiceURI}
                    onChange={(e) => setNarration({ voiceURI: e.target.value || null })}
                    disabled={!speak}
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
                    disabled={!speak}
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
                    disabled={!speak}
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
                  disabled={!speak}
                  data-testid="narration-preview"
                  title="Hear a sample with these settings"
                >
                  <Volume2 />
                  Preview voice
                </Button>
              </div>
            </div>
          )}

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
