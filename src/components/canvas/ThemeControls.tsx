import { X } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { DEFAULT_SLOT_HEX, THEME_FONT_META, type ColorScheme } from '~/lib/theme/resolveTimelineTheme'
import { THEME_FONTS, type ThemeColorSlots, type ThemeTexture, type TimelineTheme } from '~/lib/domain/types'

// Editable color slots, in display order. canvasBg last — it's the wash, not an accent.
const SLOT_META: { key: keyof ThemeColorSlots; label: string; hint: string }[] = [
  { key: 'accentPrimary', label: 'Primary', hint: 'Selection ring, primary buttons' },
  { key: 'accentStory', label: 'Story', hint: 'Story badges, "caused" edges' },
  { key: 'accentInfluence', label: 'Influence', hint: '"Influenced" edges, period lanes' },
  { key: 'accentDialogue', label: 'Dialogue', hint: '"Succeeded" edges, concepts' },
  { key: 'accentEra', label: 'Era', hint: 'Period rails' },
  { key: 'canvasBg', label: 'Canvas', hint: 'The background wash behind the graph' },
]

// The selectable textures. Clicking the active one again unsets it (back to the
// canvas's baseline dot grid), so no separate "default" option is needed.
const TEXTURE_OPTIONS: { value: ThemeTexture; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'grid', label: 'Grid' },
  { value: 'paper', label: 'Paper' },
]

// The visual-theme form body — name, per-scheme color slots, display font and
// texture — extracted from ThemeEditorDialog so it can be reused inside the project
// branding editor (its "Theme" tab). Fully controlled: the parent owns `draft` and
// the active color `scheme`; every edit flows up through onChange / onSchemeChange.
export function ThemeControls({
  draft,
  scheme,
  onSchemeChange,
  onChange,
  // The theme can carry a display name (shown on public story pages). The timeline /
  // story theme editors expose it; the project branding editor hides it (the project
  // already has a title), so it's opt-out via this flag.
  showName = true,
}: {
  draft: TimelineTheme
  scheme: ColorScheme
  onSchemeChange: (scheme: ColorScheme) => void
  onChange: (next: TimelineTheme) => void
  showName?: boolean
}) {
  const slots = draft.colors?.[scheme] ?? {}

  const setSlot = (key: keyof ThemeColorSlots, value: string | undefined) => {
    const nextSlots: ThemeColorSlots = { ...slots }
    if (value) nextSlots[key] = value
    else delete nextSlots[key]
    const colors = { ...draft.colors, [scheme]: nextSlots }
    // Drop empty scheme objects so "no overrides" round-trips as absent.
    if (Object.keys(nextSlots).length === 0) delete colors[scheme]
    onChange({ ...draft, colors: Object.keys(colors).length ? colors : undefined })
  }

  return (
    <div className="flex flex-col gap-4">
      {showName && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="theme-name">Name</Label>
          <Input
            id="theme-name"
            value={draft.name ?? ''}
            placeholder="e.g. Imperial Marble"
            maxLength={60}
            onChange={(e) => onChange({ ...draft, name: e.target.value || undefined })}
            data-testid="theme-name"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Colors</Label>
          <Tabs value={scheme} onValueChange={(v) => onSchemeChange(v as ColorScheme)}>
            <TabsList className="h-7">
              <TabsTrigger value="dark" className="px-2.5 text-xs" data-testid="theme-scheme-dark">
                Dark
              </TabsTrigger>
              <TabsTrigger value="light" className="px-2.5 text-xs" data-testid="theme-scheme-light">
                Light
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-col gap-1">
          {SLOT_META.map((s) => {
            const set = slots[s.key] != null
            // A color input can't be empty: unset slots show the brand default for
            // this scheme; touching one sets the slot. The hex is shown so the value
            // is legible, and "default" calls out a slot that's still inheriting.
            const value = slots[s.key] ?? DEFAULT_SLOT_HEX[scheme][s.key]
            return (
              <div key={s.key} className="flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm">
                <input
                  type="color"
                  value={value}
                  onChange={(e) => setSlot(s.key, e.target.value)}
                  className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0"
                  data-testid={`theme-slot-${s.key}`}
                  aria-label={`${s.label} color (${scheme})`}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="leading-tight">{s.label}</span>
                  <span className="text-xs leading-tight text-muted-foreground">{s.hint}</span>
                </div>
                <span
                  className="font-mono text-xs uppercase tabular-nums text-muted-foreground"
                  data-testid={`theme-slot-${s.key}-value`}
                >
                  {set ? value : 'default'}
                </span>
                {set ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => setSlot(s.key, undefined)}
                    title={`Reset ${s.label} to the default`}
                    aria-label={`Reset ${s.label}`}
                    data-testid={`theme-slot-${s.key}-clear`}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <span className="w-[18px]" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="theme-font">Display font</Label>
        <select
          id="theme-font"
          className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-sm"
          value={draft.font?.display ?? 'default'}
          onChange={(e) => {
            const v = e.target.value as (typeof THEME_FONTS)[number]
            onChange({ ...draft, font: v === 'default' ? undefined : { display: v } })
          }}
          data-testid="theme-font"
        >
          {THEME_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: THEME_FONT_META[f].stack ?? undefined }}>
              {THEME_FONT_META[f].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Texture</Label>
        <p className="text-xs text-muted-foreground">
          The faint pattern tiled behind the canvas. Click the active one again to clear it.
        </p>
        <div className="flex gap-1">
          {TEXTURE_OPTIONS.map((t) => {
            const active = draft.texture === t.value
            return (
              <Button
                key={t.value}
                variant={active ? 'default' : 'outline'}
                size="sm"
                className="h-7 flex-1 px-1 text-xs"
                aria-pressed={active}
                // Click the active texture again to clear it (baseline grid).
                onClick={() => onChange({ ...draft, texture: active ? undefined : t.value })}
                data-testid={`theme-texture-${t.value}`}
              >
                {t.label}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
