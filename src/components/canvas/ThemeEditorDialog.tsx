import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
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
import { Button } from '~/components/ui/button'
import { setTimelineTheme } from '~/lib/server/timelines'
import { type ColorScheme } from '~/lib/theme/resolveTimelineTheme'
import { type TimelineTheme } from '~/lib/domain/types'
import { ThemeControls } from './ThemeControls'

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

        <ThemeControls draft={draft} scheme={scheme} onSchemeChange={setScheme} onChange={update} />

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
