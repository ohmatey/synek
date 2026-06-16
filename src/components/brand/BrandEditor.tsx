import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Badge } from '~/components/ui/badge'
import { Separator } from '~/components/ui/separator'
import { toast } from 'sonner'
import { brandKitSchema, emptyBrandKit, type BrandKit } from '~/lib/domain/brand'
import { getBrand, updateBrand } from '~/lib/server/brands'

// The brand-kit editor (stories-first slice 2). Loads a brand by id, edits its kit
// section by section (Identity · Visual · Voice), and saves the whole kit through
// updateBrand (which re-validates with brandKitSchema). LEAN: local authoring —
// no Realscript fetch, no sync. A comma-list helper keeps the array fields simple.

// Split/join a comma-or-newline list for the simple array fields (industries,
// attributes, key messages, vocabulary). Trims + drops empties.
const splitList = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
const joinList = (xs: string[] | undefined): string => (xs ?? []).join(', ')

export function BrandEditor({ brandId }: { brandId: string }) {
  const qc = useQueryClient()
  const { data: brand, isLoading } = useQuery({
    queryKey: ['brand', brandId],
    queryFn: () => getBrand({ data: brandId }),
  })

  const [kit, setKit] = useState<BrandKit | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // Seed the working copy when the brand resolves. A kit-less brand gets a blank
  // kit so every section is editable from the first open.
  useEffect(() => {
    if (!brand) return
    setName(brand.name)
    setKit(brand.kit ?? emptyBrandKit(brand.name, brand.slug))
  }, [brand])

  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => {
    setKit((k) => (k ? { ...k, [key]: value } : k))
    setSaved(false)
  }
  const setVoice = (patch: Partial<NonNullable<BrandKit['voiceSchema']>>) => {
    setKit((k) => {
      if (!k) return k
      const base: NonNullable<BrandKit['voiceSchema']> = k.voiceSchema ?? {
        version: 1,
        personalityTraits: [],
        writingRules: [],
        toneSpectrum: [],
        examplePhrases: [],
        contentTypeVariations: [],
      }
      return { ...k, voiceSchema: { ...base, ...patch } }
    })
    setSaved(false)
  }

  // Validate the working copy live so the Save button reflects whether the kit is
  // currently well-formed (the server re-validates with the same schema).
  const parsed = useMemo(() => (kit ? brandKitSchema.safeParse({ ...kit, name }) : null), [kit, name])

  async function save() {
    if (busy || !kit || !parsed?.success) return
    setBusy(true)
    setSaved(false)
    try {
      await updateBrand({ data: { id: brandId, name: name.trim(), kit: parsed.data } })
      await qc.invalidateQueries({ queryKey: ['brands'] })
      await qc.invalidateQueries({ queryKey: ['brand', brandId] })
      setSaved(true)
      toast.success('Brand saved')
    } catch (e) {
      toast.error('Could not save the brand')
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="animate-spin" /></div>
  if (!brand || !kit) return <p className="py-8 text-center text-sm text-muted-foreground">Brand not found.</p>

  const voice = kit.voiceSchema

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-name">Brand name</Label>
        <Input id="brand-name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} className="max-w-sm" />
      </div>

      <Tabs defaultValue="identity" className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
        </TabsList>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {/* --- Identity ----------------------------------------------------- */}
          <TabsContent value="identity" className="mt-0 flex flex-col gap-4">
            <Field label="Tagline"><Input value={kit.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} placeholder="Roasted small, shipped fresh" /></Field>
            <Field label="Description"><Textarea value={kit.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="What this brand is, in a sentence or two." /></Field>
            <Field label="Industries" hint="comma-separated"><Input value={joinList(kit.industries)} onChange={(e) => set('industries', splitList(e.target.value))} placeholder="Food & Beverage, Retail" /></Field>
            <Field label="Target audience"><Textarea value={kit.targetAudience ?? ''} onChange={(e) => set('targetAudience', e.target.value)} placeholder="Who is this for?" /></Field>
            <Field label="Brand attributes" hint="comma-separated"><Input value={joinList(kit.brandAttributes)} onChange={(e) => set('brandAttributes', splitList(e.target.value))} placeholder="warm, precise, honest" /></Field>
            <Separator />
            <Field label="Mission"><Textarea value={kit.mission ?? ''} onChange={(e) => set('mission', e.target.value)} /></Field>
            <Field label="Vision"><Textarea value={kit.vision ?? ''} onChange={(e) => set('vision', e.target.value)} /></Field>
            <Field label="Key messages" hint="one per line"><Textarea value={(kit.keyMessages ?? []).join('\n')} onChange={(e) => set('keyMessages', splitList(e.target.value))} /></Field>
            <KeyedArrayField
              heading="Core values"
              items={kit.coreValues ?? []}
              onChange={(v) => set('coreValues', v)}
              blank={{ name: '' }}
              addLabel="Add value"
              renderRow={(cv, setCv, remove, i) => (
                <div className="flex items-center gap-2">
                  <Input aria-label={`Core value ${i + 1} name`} value={cv.name} onChange={(e) => setCv({ ...cv, name: e.target.value })} placeholder="Craft" className="w-44" />
                  <Input aria-label={`Core value ${i + 1} description`} value={cv.description ?? ''} onChange={(e) => setCv({ ...cv, description: e.target.value || undefined })} placeholder="What it means in practice" className="flex-1" />
                  <RemoveBtn label={`Remove core value ${i + 1}`} onClick={remove} />
                </div>
              )}
            />
          </TabsContent>

          {/* --- Visual ------------------------------------------------------- */}
          <TabsContent value="visual" className="mt-0 flex flex-col gap-4">
            <Field label="Palette" hint="hex colors, comma-separated">
              <Input value={joinList(kit.colors)} onChange={(e) => set('colors', splitList(e.target.value))} placeholder="#3B2A1A, #D9A066, #F4ECE2" />
              {kit.colors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {kit.colors.map((c, i) => (
                    <span key={`${c}-${i}`} className="size-6 rounded ring-1 ring-inset ring-border" style={{ backgroundColor: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : 'transparent' }} title={c} />
                  ))}
                </div>
              )}
            </Field>
            <Field label="Logo URL"><Input value={kit.logoUrl ?? ''} onChange={(e) => set('logoUrl', e.target.value || undefined)} placeholder="https://example.com/logo.svg" /></Field>
            <Field label="Visual aesthetic"><Textarea value={kit.visualAesthetic ?? ''} onChange={(e) => set('visualAesthetic', e.target.value)} placeholder="Warm earth tones, generous whitespace…" /></Field>
            <Field label="Fonts" hint="name and family, one per line as “Name | family”">
              <Textarea
                value={(kit.fonts ?? []).map((f) => `${f.name} | ${f.family}`).join('\n')}
                onChange={(e) =>
                  set(
                    'fonts',
                    e.target.value
                      .split('\n')
                      .map((line) => line.split('|').map((x) => x.trim()))
                      .filter(([n, fam]) => n && fam)
                      .map(([name, family]) => ({ name, family })),
                  )
                }
                placeholder="Inter | Inter, system-ui, sans-serif"
              />
            </Field>
          </TabsContent>

          {/* --- Voice -------------------------------------------------------- */}
          <TabsContent value="voice" className="mt-0 flex flex-col gap-5">
            <KeyedArrayField
              heading="Personality traits"
              items={voice?.personalityTraits ?? []}
              onChange={(v) => setVoice({ personalityTraits: v })}
              blank={{ trait: '', intensity: 5 }}
              addLabel="Add trait"
              renderRow={(t, setT, remove, i) => (
                <div className="flex items-center gap-2">
                  <Input aria-label={`Trait ${i + 1} name`} value={t.trait} onChange={(e) => setT({ ...t, trait: e.target.value })} placeholder="Confident" />
                  <Input aria-label={`Trait ${i + 1} intensity (1–10)`} type="number" min={1} max={10} value={t.intensity} onChange={(e) => setT({ ...t, intensity: clampInt(e.target.value, 1, 10) })} className="w-20" />
                  <RemoveBtn label={`Remove trait ${i + 1}`} onClick={remove} />
                </div>
              )}
            />

            <Separator />
            <KeyedArrayField
              heading="Writing rules"
              items={voice?.writingRules ?? []}
              onChange={(v) => setVoice({ writingRules: v })}
              blank={{ type: 'do' as 'do' | 'dont', rule: '' }}
              addLabel="Add rule"
              renderRow={(r, setR, remove, i) => (
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                    value={r.type}
                    onChange={(e) => setR({ ...r, type: e.target.value as 'do' | 'dont' })}
                    aria-label={`Rule ${i + 1} type`}
                  >
                    <option value="do">Do</option>
                    <option value="dont">Don’t</option>
                  </select>
                  <Input aria-label={`Rule ${i + 1}`} value={r.rule} onChange={(e) => setR({ ...r, rule: e.target.value })} placeholder="Lead with origin" />
                  <RemoveBtn label={`Remove rule ${i + 1}`} onClick={remove} />
                </div>
              )}
            />

            <Separator />
            <KeyedArrayField
              heading="Tone spectrum"
              items={voice?.toneSpectrum ?? []}
              onChange={(v) => setVoice({ toneSpectrum: v })}
              blank={{ dimension: '', labelLow: '', labelHigh: '', value: 50 }}
              addLabel="Add tone dimension"
              renderRow={(d, setD, remove, i) => (
                <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Tone dimension ${i + 1} name`} value={d.dimension} onChange={(e) => setD({ ...d, dimension: e.target.value })} placeholder="warmth" />
                    <RemoveBtn label={`Remove tone dimension ${i + 1}`} onClick={remove} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Tone dimension ${i + 1} low label`} value={d.labelLow} onChange={(e) => setD({ ...d, labelLow: e.target.value })} placeholder="Professional" className="flex-1" />
                    <Input aria-label={`Tone dimension ${i + 1} value (0–100)`} type="number" min={0} max={100} value={d.value} onChange={(e) => setD({ ...d, value: clampInt(e.target.value, 0, 100) })} className="w-20" />
                    <Input aria-label={`Tone dimension ${i + 1} high label`} value={d.labelHigh} onChange={(e) => setD({ ...d, labelHigh: e.target.value })} placeholder="Warm" className="flex-1" />
                  </div>
                </div>
              )}
            />

            <Separator />
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Vocabulary</h3>
              <Field label="Preferred" hint="comma-separated"><Input value={joinList(voice?.vocabulary?.preferred)} onChange={(e) => setVoice({ vocabulary: { preferred: splitList(e.target.value), avoided: voice?.vocabulary?.avoided ?? [], jargonLevel: voice?.vocabulary?.jargonLevel } })} placeholder="origin, craft" /></Field>
              <Field label="Avoided" hint="comma-separated"><Input value={joinList(voice?.vocabulary?.avoided)} onChange={(e) => setVoice({ vocabulary: { preferred: voice?.vocabulary?.preferred ?? [], avoided: splitList(e.target.value), jargonLevel: voice?.vocabulary?.jargonLevel } })} placeholder="cheap, synergy" /></Field>
            </section>
          </TabsContent>
        </div>
      </Tabs>

      <Separator />
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || !name.trim() || !parsed?.success}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Save brand
        </Button>
        {saved && <span className="inline-flex items-center gap-1.5 text-sm text-foreground"><Check className="size-4" /> Saved</span>}
        {parsed && !parsed.success && <Badge variant="outline" className="text-destructive">Fix fields before saving</Badge>}
      </div>
    </div>
  )
}

// --- small editor helpers --------------------------------------------------
// Wrapping the control INSIDE the <label> gives the input an accessible name
// without threading an id through every Field (implicit label association — works
// for getByLabel + AT). The text sits in its own block above the control.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col items-stretch gap-1.5">
      <span className="flex items-center gap-2">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </Label>
  )
}

// An editable array of rows with STABLE keys, so deleting a middle row never makes
// React reconcile by index (which mis-assigns focus and transient DOM state on the
// surviving rows). Keys are tracked parallel to the data and only regenerated when
// the array length changes from outside (e.g. a kit loads); add/remove adjust both
// data and keys in lockstep, and editing a field leaves length — and keys — stable.
// renderRow owns the row's controls + its own Remove (placed wherever the layout
// needs it) and is handed a unique `index` for per-row accessible names.
function KeyedArrayField<T>({
  heading,
  items,
  onChange,
  blank,
  addLabel,
  renderRow,
}: {
  heading: string
  items: T[]
  onChange: (next: T[]) => void
  blank: T
  addLabel: string
  renderRow: (item: T, set: (v: T) => void, remove: () => void, index: number) => React.ReactNode
}) {
  const nextRef = useRef(0)
  const [keys, setKeys] = useState<number[]>([])
  // Adjust keys to match the data length (the supported "derive state during
  // render" pattern — converges immediately because the branch makes lengths equal).
  if (keys.length !== items.length) {
    const synced = keys.slice(0, items.length)
    while (synced.length < items.length) synced.push(nextRef.current++)
    setKeys(synced)
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      {items.map((item, i) => (
        <Fragment key={keys[i] ?? i}>
          {renderRow(
            item,
            (v) => onChange(replaceAt(items, i, v)),
            () => {
              setKeys((ks) => ks.filter((_, j) => j !== i))
              onChange(removeAt(items, i))
            },
            i,
          )}
        </Fragment>
      ))}
      <AddBtn
        label={addLabel}
        onClick={() => {
          setKeys((ks) => [...ks, nextRef.current++])
          onChange([...items, blank])
        }}
      />
    </section>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="self-start" onClick={onClick}>
      <Plus className="size-3.5" /> {label}
    </Button>
  )
}
function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} aria-label={label}>
      <Trash2 className="size-4" />
    </Button>
  )
}
function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const next = arr.slice()
  next[i] = v
  return next
}
function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, j) => j !== i)
}
function clampInt(s: string, lo: number, hi: number): number {
  const n = Math.round(Number(s))
  if (Number.isNaN(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
