import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Palette, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { toast } from 'sonner'
import { listBrands, createBrand, deleteBrand } from '~/lib/server/brands'
import { BrandEditor } from './BrandEditor'
import { ProjectBrandLink } from './ProjectBrandLink'

// The brand-kit manager (stories-first slice 2): a list of the owner's local brand
// kits, a create affordance, and — drilling into one — the section editor + an
// optional project-link control. LEAN: local authoring only. Opens as a modal over
// the current view (the cinematic home), like SettingsDialog.
export function BrandManagerDialog({
  open,
  onOpenChange,
  // When provided, the editor shows a "link this brand to <project>" control so a
  // creator can dress the project they're viewing. Optional — the manager works
  // standalone from anywhere.
  linkProject,
  // When provided, the manager opens drilled straight into this brand's editor
  // (a brand card on the home links here). Cleared to the list on close.
  initialBrandId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  linkProject?: { id: string; title: string } | null
  initialBrandId?: string | null
}) {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => listBrands(),
    enabled: open,
  })

  // Reset the drill-in/new-name state whenever the dialog closes; when it opens
  // with an initialBrandId, drill straight into that brand's editor.
  useEffect(() => {
    if (!open) {
      setEditingId(null)
      setNewName('')
      setCreating(false)
    } else if (initialBrandId) {
      setEditingId(initialBrandId)
    }
  }, [open, initialBrandId])

  async function create() {
    const name = newName.trim()
    if (creating || !name) return
    setCreating(true)
    try {
      const brand = await createBrand({ data: { name } })
      await qc.invalidateQueries({ queryKey: ['brands'] })
      setNewName('')
      setEditingId(brand.id) // drill straight into the new brand's editor
    } catch (e) {
      toast.error('Could not create the brand')
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  async function remove(id: string, name: string) {
    try {
      await deleteBrand({ data: id })
      await qc.invalidateQueries({ queryKey: ['brands'] })
      // The link control / project queries may reference this brand — refresh them.
      await qc.invalidateQueries({ queryKey: ['project-brand'] })
      toast.success(`Deleted “${name}”`)
    } catch (e) {
      toast.error('Could not delete the brand')
      console.error(e)
    }
  }

  const editing = brands.find((b) => b.id === editingId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="icon" className="-ml-2" onClick={() => setEditingId(null)} aria-label="Back to brands">
                  <ArrowLeft className="size-4" />
                </Button>
                {editing.name}
              </>
            ) : (
              <>
                <Palette className="size-4 text-muted-foreground" />
                Brand kits
              </>
            )}
          </DialogTitle>
          <DialogDescription className={editing ? 'sr-only' : undefined}>
            {editing
              ? 'Edit this brand kit.'
              : 'Author a brand kit — identity, palette, and voice — then link it to a project to dress its stories.'}
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            {linkProject && (
              <ProjectBrandLink project={linkProject} brandId={editing.id} brandName={editing.name} />
            )}
            <BrandEditor brandId={editing.id} />
          </div>
        ) : (
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="new-brand-name">New brand</Label>
                <Input id="new-brand-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Northwind Coffee" />
              </div>
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                Create
              </Button>
            </form>

            {isLoading ? (
              <div className="grid place-items-center py-8 text-muted-foreground"><Loader2 className="animate-spin" /></div>
            ) : brands.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No brand kits yet. Create one above.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {brands.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <button type="button" className="flex flex-1 flex-col items-start text-left" onClick={() => setEditingId(b.id)}>
                      <span className="text-sm font-medium">{b.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {b.kit?.tagline || (b.kit ? 'Brand kit' : 'Empty — click to author')}
                      </span>
                    </button>
                    {/* swatch preview */}
                    {(b.kit?.colors ?? []).slice(0, 4).map((c, i) => (
                      <span key={i} className="size-4 rounded-sm ring-1 ring-inset ring-border" style={{ backgroundColor: c }} title={c} />
                    ))}
                    <Button variant="ghost" size="icon" onClick={() => void remove(b.id, b.name)} aria-label={`Delete ${b.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
