import { useState, type ReactNode } from 'react'
import { useReactFlow, useStore, useViewport } from '@xyflow/react'
import { Check, Loader2, Minus, Palette, Plus, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '@synek/ui'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/utils'
import { setTimelineView } from '~/lib/server/timelines'
import { PromptDialog } from '~/components/PromptDialog'
import { themeTimelineSpec } from '~/lib/verbs'
import { VTAB } from '~/components/ui/vtab'
import { ThemeEditorDialog } from './ThemeEditorDialog'
import { DEFAULT_SLOT_HEX } from '~/lib/theme/resolveTimelineTheme'
import type { TimelineTheme } from '~/lib/domain/types'
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

const PRESETS: { label: string; years: number }[] = [
  { label: 'Decade', years: 10 },
  { label: 'Century', years: 100 },
  { label: 'Millennium', years: 1000 },
]

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

function formatSpan(years: number): string {
  if (years >= 1000) {
    const k = years / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)} kyr`
  }
  if (years >= 1) return `${Math.round(years)} yr`
  return `${Math.max(1, Math.round(years * 12))} mo`
}

// Uniform section header within a tab — an uppercase muted label with an optional
// right-aligned aside (the live readout, a "Show all" reset, …).
function SectionHeader({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-5 items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>
      {aside}
    </div>
  )
}

type TLTab = 'display' | 'playback' | 'theme'

const TAB_LABEL: Record<TLTab, string> = {
  display: 'Display',
  playback: 'Playback',
  theme: 'Theme',
}

// The timeline's "view settings" → a tabbed dialog (matching the account settings
// dialog: left-side vertical tabs). Display = the time-axis zoom + which kinds show
// + live updates + save-as-default; Playback = story auto-play + read-aloud +
// narration; Theme (owner) = this timeline's look. Lives outside <ReactFlow> but
// inside <ReactFlowProvider>, so useReactFlow / useStore reach the live viewport.
export function CanvasSettings({
  timelineId,
  timelineTitle,
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
  autoPlay,
  onAutoPlay,
  kindCounts,
  hiddenKinds,
  onToggleKind,
  onResetKinds,
  theme,
  onPreviewTheme,
}: {
  timelineId: string
  timelineTitle: string
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
  autoPlay: boolean
  onAutoPlay: (next: boolean) => void
  kindCounts: Map<string, number>
  hiddenKinds: Set<string>
  onToggleKind: (token: string) => void
  onResetKinds: () => void
  theme: TimelineTheme | null
  onPreviewTheme: (theme: TimelineTheme | null) => void
}) {
  const rf = useReactFlow()
  const width = useStore((s) => s.width)
  const { zoom } = useViewport()
  const { resolvedTheme } = useTheme()
  const [saving, setSaving] = useState(false)
  // Controlled so opening the theme editor / agent prompt can close it first (the
  // dialogs render as SIBLINGS — the settings dialog must close so two modals
  // don't stack).
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TLTab>('display')
  const [themeEditorOpen, setThemeEditorOpen] = useState(false)
  const [themePromptOpen, setThemePromptOpen] = useState(false)
  const speechSupported = useSpeechSupported()
  const [narration, setNarration] = useNarrationPrefs()
  const voices = useNarrationVoices()
  const selectedVoiceURI =
    narration.voiceURI && voices.some((v) => v.voiceURI === narration.voiceURI) ? narration.voiceURI : ''

  const presentKinds = KIND_META.filter((k) => (kindCounts.get(k.token) ?? 0) > 0)
  const hiddenCount = hiddenKinds.size

  const apply = (nextPxPerDay: number, nextCollapse: boolean) => {
    const clamped = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, nextPxPerDay))
    if (clamped === pxPerDay && nextCollapse === collapseGaps) return

    const vp = rf.getViewport()
    if (width && vp.zoom) {
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
  const spanYears = width && zoom ? width / zoom / (pxPerDay * DAYS_PER_YEAR) : null

  async function saveDefault() {
    if (saving) return
    setSaving(true)
    try {
      await setTimelineView({ data: { id: timelineId, view: { pxPerDay, collapseGaps } } })
      saveScalePref(timelineId, { pxPerDay, collapseGaps, autoRefresh, speak, autoPlay, chosen: true })
      toast.success('Saved as this timeline’s default scale')
    } catch {
      toast.error('Couldn’t save the default')
    } finally {
      setSaving(false)
    }
  }

  const themeSlots = theme?.colors?.[resolvedTheme] ?? {}
  const swatch = (key: keyof typeof DEFAULT_SLOT_HEX.dark) => themeSlots[key] ?? DEFAULT_SLOT_HEX[resolvedTheme][key]

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
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
        </DialogTrigger>
        <DialogContent className="flex h-[min(85vh,40rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <Tabs
            orientation="vertical"
            value={tab}
            onValueChange={(v) => setTab(v as TLTab)}
            className="flex min-h-0 w-full flex-row gap-0"
          >
            <div className="flex w-44 shrink-0 flex-col border-r border-border bg-muted/30">
              <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
                <DialogTitle className="text-sm font-semibold">Timeline settings</DialogTitle>
                <DialogDescription className="sr-only">
                  Adjust the time-axis zoom, which node kinds show, story playback, and this timeline’s theme.
                </DialogDescription>
              </div>
              <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 rounded-none bg-transparent p-3">
                <TabsTrigger value="display" className={VTAB}>
                  Display
                </TabsTrigger>
                <TabsTrigger value="playback" className={VTAB}>
                  Playback
                </TabsTrigger>
                {isOwner && (
                  <TabsTrigger value="theme" className={VTAB}>
                    Theme
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex h-14 shrink-0 items-center border-b border-border px-5 pr-12">
                <h2 className="text-sm font-semibold">{TAB_LABEL[tab]}</h2>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {/* ── Display: time scale + filters + live updates + save default ── */}
              <TabsContent value="display" className="mt-0 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <SectionHeader
                    aside={
                      spanYears != null && (
                        <span className="tabular-nums text-xs text-muted-foreground" data-testid="time-scale-level">
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
                              className={cn('text-[10px] tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}
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
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: k.color }} aria-hidden />
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

                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span className="flex-1" title="Stream changes from your MCP client in near-real-time (no page reload)">
                    Live updates
                  </span>
                  <Switch
                    checked={autoRefresh}
                    onCheckedChange={onAutoRefresh}
                    data-testid="auto-refresh-toggle"
                    aria-label="Live updates"
                  />
                </label>

                {isOwner && (
                  <div className="flex flex-col gap-2 border-t border-border pt-4">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Save the current scale as this timeline’s default — applied whenever it’s opened on a fresh device.
                    </p>
                    <Button variant="default" size="sm" className="w-full" onClick={saveDefault} disabled={saving}>
                      {saving && <Loader2 className="animate-spin" />}
                      Save as default
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* ── Playback: story auto-play + read-aloud + narration ── */}
              <TabsContent value="playback" className="mt-0 flex flex-col gap-1">
                <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
                  <span
                    className="flex-1"
                    title="Story beats advance on their own (Reels-style); off makes the reader fully manual"
                  >
                    Auto-play stories
                  </span>
                  <Switch
                    checked={autoPlay}
                    onCheckedChange={onAutoPlay}
                    data-testid="autoplay-stories-toggle"
                    aria-label="Auto-play stories"
                  />
                </label>

                {speechSupported && (
                  <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="flex-1" title="Read stories aloud as the reader plays each beat (browser speech)">
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
                        <span className="tabular-nums text-xs text-muted-foreground">{narration.rate.toFixed(2)}×</span>
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
                        <span className="tabular-nums text-xs text-muted-foreground">{narration.pitch.toFixed(2)}</span>
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
              </TabsContent>

              {/* ── Theme (owner): this timeline's look ── */}
              {isOwner && (
                <TabsContent value="theme" className="mt-0 flex flex-col gap-2">
                  <SectionHeader
                    aside={theme?.name && <span className="text-xs font-normal text-muted-foreground">{theme.name}</span>}
                  >
                    Theme
                  </SectionHeader>
                  <div className="flex items-center gap-1.5 px-0.5" aria-hidden data-testid="theme-swatches">
                    {(['accentPrimary', 'accentStory', 'accentInfluence', 'accentDialogue', 'accentEra'] as const).map(
                      (k) => (
                        <span key={k} className="size-2.5 rounded-full" style={{ background: swatch(k) }} />
                      ),
                    )}
                    <span
                      className="ml-1 h-2.5 w-6 rounded-sm border border-border"
                      style={{ background: swatch('canvasBg') }}
                      title="Canvas background"
                    />
                    {!theme && <span className="ml-auto text-xs text-muted-foreground">default</span>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      data-testid="theme-edit"
                      onClick={() => {
                        setOpen(false)
                        setThemeEditorOpen(true)
                      }}
                    >
                      <Palette />
                      Edit theme
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      data-testid="theme-prompt"
                      title="Copy a prompt that has your connected Claude design the theme"
                      onClick={() => {
                        setOpen(false)
                        setThemePromptOpen(true)
                      }}
                    >
                      <Sparkles />
                      Ask your agent
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This timeline’s look — colors, font, and texture — seen by every viewer.
                  </p>
                </TabsContent>
              )}
              </div>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Siblings of the Dialog root on purpose (see `open` above). */}
      <ThemeEditorDialog
        open={themeEditorOpen}
        onOpenChange={setThemeEditorOpen}
        timelineId={timelineId}
        theme={theme}
        onPreview={onPreviewTheme}
      />
      <PromptDialog
        open={themePromptOpen}
        onOpenChange={setThemePromptOpen}
        spec={themeTimelineSpec({ timelineId, timelineTitle, surface: 'canvas_settings' })}
      />
    </>
  )
}
