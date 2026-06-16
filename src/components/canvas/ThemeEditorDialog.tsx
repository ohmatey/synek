import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '@synek/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { setTimelineTheme } from '~/lib/server/timelines'
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

// Owner-only editor for a visual theme (a timeline's, or — when `onSave` is given —
// a story's, since both share the TimelineTheme shape). Every edit live-previews via
// onPreview (the canvas behind the dialog); Save persists and hands display back to
// server truth, Cancel/close drops the preview. By default it writes the timeline
// theme through setTimelineTheme (same row the MCP set_timeline_theme tool writes);
// pass `onSave` to redirect the write (e.g. a story theme via setStoryTheme, or just
// stashing a not-yet-created story's theme in local state). onPreview is optional —
// scopes with no live canvas (a pre-creation story theme) simply omit it.
export function ThemeEditorDialog({
  open,
  onOpenChange,
  timelineId,
  theme,
  onPreview,
  title = 'Timeline theme',
  description = 'Colors, font and texture for this timeline — every viewer sees them. The canvas behind this dialog previews as you edit.',
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Required only for the default (timeline) save path; omit it when passing onSave.
  timelineId?: string
  theme: TimelineTheme | null
  onPreview?: (theme: TimelineTheme | null) => void
  title?: string
  description?: string
  // Override the persist step. Receives the normalized theme (null = clear). When
  // omitted, the dialog writes the timeline theme via setTimelineTheme + invalidate.
  onSave?: (theme: TimelineTheme | null) => Promise<void>
}) {
  const qc = useQueryClient()
  const { resolvedTheme } = useTheme()
  const [scheme, setScheme] = useState<ColorScheme>(resolvedTheme)
  const [draft, setDraft] = useState<TimelineTheme>(() => theme ?? {})
  const [saving, setSaving] = useState(false)

  // Re-seed from the saved theme each time the editor opens (it may have changed
  // live via MCP since the last session), and start on the scheme the user sees.
  useEffect(() => {
    if (open) {
      setDraft(theme ?? {})
      setScheme(resolvedTheme)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (next: TimelineTheme) => {
    setDraft(next)
    onPreview?.(next)
  }

  const slots = draft.colors?.[scheme] ?? {}

  const setSlot = (key: keyof ThemeColorSlots, value: string | undefined) => {
    const nextSlots: ThemeColorSlots = { ...slots }
    if (value) nextSlots[key] = value
    else delete nextSlots[key]
    const colors = { ...draft.colors, [scheme]: nextSlots }
    // Drop empty scheme objects so "no overrides" round-trips as absent.
    if (Object.keys(nextSlots).length === 0) delete colors[scheme]
    update({ ...draft, colors: Object.keys(colors).length ? colors : undefined })
  }

  const close = (nextOpen: boolean) => {
    if (!nextOpen) onPreview?.(null) // cancel/esc → back to server truth
    onOpenChange(nextOpen)
  }

  async function save(next: TimelineTheme | null) {
    if (saving) return
    setSaving(true)
    try {
      // Normalize: an all-empty draft saves as null (clear), not as `{}`.
      const payload = next && Object.values(next).some((v) => v !== undefined) ? next : null
      if (onSave) {
        await onSave(payload)
      } else {
        await setTimelineTheme({ data: { id: timelineId!, theme: payload } })
        await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      }
      onPreview?.(null)
      onOpenChange(false)
      toast.success(payload ? 'Theme saved' : 'Theme cleared')
    } catch {
      toast.error('Couldn’t save the theme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-name">Name</Label>
            <Input
              id="theme-name"
              value={draft.name ?? ''}
              placeholder="e.g. Imperial Marble"
              maxLength={60}
              onChange={(e) => update({ ...draft, name: e.target.value || undefined })}
              data-testid="theme-name"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Colors</Label>
              <Tabs value={scheme} onValueChange={(v) => setScheme(v as ColorScheme)}>
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
            <div className="flex flex-col gap-0.5">
              {SLOT_META.map((s) => {
                const set = slots[s.key] != null
                return (
                  <div key={s.key} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm">
                    {/* A color input can't be empty: unset slots show the brand
                        default for this scheme; touching one sets the slot. */}
                    <input
                      type="color"
                      value={slots[s.key] ?? DEFAULT_SLOT_HEX[scheme][s.key]}
                      onChange={(e) => setSlot(s.key, e.target.value)}
                      className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                      data-testid={`theme-slot-${s.key}`}
                      aria-label={`${s.label} color (${scheme})`}
                    />
                    <span className="flex-1" title={s.hint}>
                      {s.label}
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
                      <span className="text-xs text-muted-foreground">default</span>
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
                update({ ...draft, font: v === 'default' ? undefined : { display: v } })
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
                    onClick={() => update({ ...draft, texture: active ? undefined : t.value })}
                    data-testid={`theme-texture-${t.value}`}
                  >
                    {t.label}
                  </Button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {theme ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => save(null)}
              disabled={saving}
              data-testid="theme-clear"
            >
              Clear theme
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => close(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => save(draft)} disabled={saving} data-testid="theme-save">
              {saving && <Loader2 className="animate-spin" />}
              Save theme
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
