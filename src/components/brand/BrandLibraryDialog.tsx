import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  listBrands,
  createBrand,
  getBrand,
  updateBrand,
  deleteBrand,
  getDefaultBrandId,
  setDefaultBrand,
} from '~/lib/server/brands'
import { brandKitSchema, emptyBrandKit, type BrandKit } from '~/lib/domain/brand'
import { IdentityFields, VisualFields, VoiceFields, withVoicePatch, type VoicePatch } from './BrandKitFields'

// The brand LIBRARY — the owner's reusable brand kits, listed and managed in one place
// (brands are a first-class entity now, not folded into a project). Two modes: a LIST
// of kits (create / set-default / edit / delete) and an inline EDITOR (Identity · Visual
// · Voice). "Default" is the workspace-default brand new stories/series inherit. A kit
// is REFERENCED by stories/series (story/series brand pickers), never copied.
export function BrandLibraryDialog({
  open,
  onOpenChange,
  // When set, opening the dialog creates a fresh brand and jumps straight to its
  // editor (the BrandPicker's inline "New brand"). onCreated fires with the new id so
  // the caller can reference it immediately.
  autoCreate = false,
  onCreated,
  // When set, opening jumps straight to this brand's editor (the Home "Brand kits"
  // row's card click) instead of the list.
  initialEditId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  autoCreate?: boolean
  onCreated?: (brandId: string) => void
  initialEditId?: string | null
}) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  // The brand pending an inline delete confirmation (its id), or null.
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const brands = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(), enabled: open })
  const defaultId = useQuery({ queryKey: ['default-brand'], queryFn: () => getDefaultBrandId(), enabled: open })

  // On open, jump to a requested kit's editor (Home card click), else the list.
  useEffect(() => {
    if (open) {
      setEditId(initialEditId ?? null)
      setConfirmId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['brands'] }), qc.invalidateQueries({ queryKey: ['default-brand'] })])

  async function createNew() {
    const b = await createBrand({ data: { name: 'New brand' } })
    await qc.invalidateQueries({ queryKey: ['brands'] })
    setEditId(b.id)
    onCreated?.(b.id)
  }

  // Inline-create on open (the picker path): create once per open.
  const autoCreated = useRef(false)
  useEffect(() => {
    if (!open) {
      autoCreated.current = false
      return
    }
    if (autoCreate && !autoCreated.current) {
      autoCreated.current = true
      void createNew()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoCreate])

  async function makeDefault(brandId: string | null) {
    await setDefaultBrand({ data: { brandId } })
    await qc.invalidateQueries({ queryKey: ['default-brand'] })
    // The story "brand costume" reads the default — refresh it.
    await qc.invalidateQueries({ queryKey: ['timeline-brand'] })
  }

  async function remove(brandId: string) {
    setConfirmId(null)
    await deleteBrand({ data: brandId })
    await refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        {editId ? (
          <BrandEditor brandId={editId} onBack={() => setEditId(null)} onSaved={() => void refresh()} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Brand kits</DialogTitle>
              <DialogDescription>
                Reusable identity, palette and voice. Set one as the default for new stories and series, or pick a
                brand per story/series. Applying a brand seeds its visual theme (you can tweak it after).
              </DialogDescription>
            </DialogHeader>

            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {brands.isLoading ? (
                <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="animate-spin" /></div>
              ) : (brands.data?.length ?? 0) === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No brand kits yet — create one to dress your stories.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {brands.data!.map((b) => {
                    const isDefault = defaultId.data === b.id
                    const swatches = (b.kit?.colors ?? []).filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 4)
                    return (
                      <li
                        key={b.id}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {b.name}
                            {isDefault && <Badge variant="secondary" className="rounded-full">Default</Badge>}
                          </span>
                          {/* A palette preview so kits are scannable at a glance, not "Kit set". */}
                          {swatches.length > 0 ? (
                            <span className="mt-1 flex items-center gap-1">
                              {swatches.map((c, i) => (
                                <span
                                  key={i}
                                  className="size-3 rounded-full ring-1 ring-inset ring-foreground/15"
                                  style={{ background: c }}
                                />
                              ))}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{b.kit ? 'No palette yet' : 'Empty kit'}</span>
                          )}
                        </div>
                        {confirmId === b.id ? (
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="sm:hidden">Delete?</span>
                            <span className="hidden sm:inline">Delete? (keeps the look, loses the link)</span>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>Cancel</Button>
                            <Button variant="destructive" size="sm" onClick={() => void remove(b.id)}>Delete</Button>
                          </span>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void makeDefault(isDefault ? null : b.id)}
                              title={isDefault ? 'Clear default' : 'Set as default'}
                            >
                              {isDefault ? <Check className="size-4" /> : <Star className="size-4" />}
                              {isDefault ? 'Clear default' : 'Set default'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setEditId(b.id)}>Edit</Button>
                            <Button variant="ghost" size="icon" aria-label={`Delete ${b.name}`} onClick={() => setConfirmId(b.id)}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => void createNew()}>
                <Plus className="size-4" />
                New brand
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// The inline kit editor (Identity · Visual · Voice), seeded from the brand row.
function BrandEditor({ brandId, onBack, onSaved }: { brandId: string; onBack: () => void; onSaved: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['brand', brandId], queryFn: () => getBrand({ data: brandId }) })
  const [name, setName] = useState('')
  const [kit, setKit] = useState<BrandKit | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setName(data.name)
    setKit(data.kit ?? emptyBrandKit(data.name, data.slug))
  }, [data])

  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => setKit((k) => (k ? { ...k, [key]: value } : k))
  const setVoice = (patch: VoicePatch) => setKit((k) => (k ? withVoicePatch(k, patch) : k))

  const parsed = useMemo(() => (kit ? brandKitSchema.safeParse({ ...kit, name, slug: data?.slug ?? 'brand' }) : null), [kit, name, data])

  async function save() {
    if (saving || !kit || !parsed?.success) return
    setSaving(true)
    try {
      await updateBrand({ data: { id: brandId, name: name.trim(), kit: parsed.data } })
      toast.success('Brand saved')
      onSaved()
      onBack()
    } catch (e) {
      toast.error('Couldn’t save the brand')
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="grid size-7 place-items-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Back to brands">
            <ArrowLeft className="size-4" />
          </button>
          Edit brand
        </DialogTitle>
        <DialogDescription>Identity, palette and voice. Apply this brand to a story or series to dress it.</DialogDescription>
      </DialogHeader>

      {isLoading || !kit ? (
        <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Name</Label>
            <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Tabs defaultValue="identity" className="flex min-h-0 flex-1 flex-col gap-4">
            <TabsList>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="visual">Visual</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
            </TabsList>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <TabsContent value="identity" className="mt-0"><IdentityFields kit={kit} set={set} /></TabsContent>
              <TabsContent value="visual" className="mt-0"><VisualFields kit={kit} set={set} /></TabsContent>
              <TabsContent value="voice" className="mt-0"><VoiceFields kit={kit} setVoice={setVoice} /></TabsContent>
            </div>
          </Tabs>
        </>
      )}

      <DialogFooter className="gap-2">
        {parsed && !parsed.success && (
          <Badge variant="outline" className="mr-auto text-destructive">Fix brand fields before saving</Badge>
        )}
        <Button variant="outline" size="sm" onClick={onBack} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || !kit || !parsed?.success || !name.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
