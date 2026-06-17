import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { ThemeControls } from '~/components/canvas/ThemeControls'
import { getProjectBranding, setProjectTheme, setProjectBrandKit } from '~/lib/server/projects'
import { brandKitSchema, emptyBrandKit, type BrandKit } from '~/lib/domain/brand'
import { type ColorScheme } from '~/lib/theme/resolveTimelineTheme'
import { type TimelineTheme } from '~/lib/domain/types'
import { VoiceFields, withVoicePatch, type VoicePatch } from './BrandKitFields'

// The project's BUILT-IN branding editor — the single home for a project's look and
// voice now that the per-account brand-kit library is folded in. One dialog, four
// tabs: Theme (the visual identity that renders on the canvas / story pages, written
// to projects.theme) and Identity · Visual · Voice (the brand kit the story "costume"
// reads, written to projects.brand). Seeds from getProjectBranding so a caller only
// needs the projectId; Save persists both halves.
export function ProjectBrandingDialog({
  open,
  onOpenChange,
  projectId,
  // Which tab to open on (the story dialog deep-links to 'identity' to set up a voice).
  initialTab = 'theme',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  initialTab?: 'theme' | 'voice'
}) {
  const qc = useQueryClient()
  const { resolvedTheme } = useTheme()

  const { data, isLoading } = useQuery({
    queryKey: ['project-branding', projectId],
    queryFn: () => getProjectBranding({ data: projectId }),
    enabled: open,
  })

  const [tab, setTab] = useState(initialTab)
  const [scheme, setScheme] = useState<ColorScheme>(resolvedTheme)
  const [themeDraft, setThemeDraft] = useState<TimelineTheme>({})
  const [kit, setKit] = useState<BrandKit | null>(null)
  const [name, setName] = useState('')
  // Only write the brand kit on Save when the user actually touched it (or one already
  // exists) — a project that just wants a theme shouldn't get an empty kit written.
  const [brandDirty, setBrandDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Re-seed from server truth each open (it may have changed via MCP / another tab).
  useEffect(() => {
    if (!open || !data) return
    setTab(initialTab)
    setScheme(resolvedTheme)
    setThemeDraft(data.theme ?? {})
    setKit(data.brand ?? emptyBrandKit(data.title, data.slug))
    setName(data.brand?.name ?? data.title)
    setBrandDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data])

  const setVoice = (patch: VoicePatch) => {
    setKit((k) => (k ? withVoicePatch(k, patch) : k))
    setBrandDirty(true)
  }

  // Whether Save will write the brand half, and whether the kit is currently valid.
  const brandExists = !!data?.brand
  const willSaveBrand = brandDirty || brandExists
  const parsed = useMemo(() => (kit ? brandKitSchema.safeParse({ ...kit, name }) : null), [kit, name])

  async function save() {
    if (saving || !kit) return
    if (willSaveBrand && !parsed?.success) return
    setSaving(true)
    try {
      // Normalize the theme: an all-empty draft clears to null, never `{}`.
      const themePayload = Object.values(themeDraft).some((v) => v !== undefined) ? themeDraft : null
      await setProjectTheme({ data: { id: projectId, theme: themePayload } })
      if (willSaveBrand && parsed?.success) {
        await setProjectBrandKit({ data: { id: projectId, kit: parsed.data } })
      }
      await qc.invalidateQueries({ queryKey: ['project-branding', projectId] })
      await qc.invalidateQueries({ queryKey: ['projects'] })
      // The story "brand costume" reads this project's voice — refresh it.
      await qc.invalidateQueries({ queryKey: ['timeline-brand'] })
      toast.success('Project branding saved')
      onOpenChange(false)
    } catch (e) {
      toast.error('Couldn’t save the project branding')
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project branding</DialogTitle>
          <DialogDescription>
            A theme and brand voice built into this project — its timelines and stories inherit them.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !kit ? (
          <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="animate-spin" /></div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col gap-4">
            <TabsList>
              <TabsTrigger value="theme">Theme</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
            </TabsList>

            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <TabsContent value="theme" className="mt-0">
                <ThemeControls draft={themeDraft} scheme={scheme} onSchemeChange={setScheme} onChange={setThemeDraft} showName={false} />
              </TabsContent>

              <TabsContent value="voice" className="mt-0">
                <VoiceFields kit={kit} setVoice={setVoice} />
              </TabsContent>
            </div>
          </Tabs>
        )}

        <DialogFooter className="gap-2 sm:items-center sm:justify-end">
          {willSaveBrand && parsed && !parsed.success && (
            <Badge variant="outline" className="mr-auto text-destructive">Fix brand fields before saving</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || isLoading || !kit || (willSaveBrand && !parsed?.success) || (willSaveBrand && !name.trim())}
            data-testid="project-branding-save"
          >
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
