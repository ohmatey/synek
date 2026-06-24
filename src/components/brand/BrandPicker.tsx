import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Palette, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { listBrands } from '~/lib/server/brands'
import { BrandLibraryDialog } from './BrandLibraryDialog'

// A compact brand selector — lists the owner's brand kits and applies one to a scope
// (story or series). Applying SEEDS the scope's visual theme from the kit (one-shot,
// tweakable after) and references the brand for voice. "No brand" clears the link.
// Reused by the story dialog and the series detail page.
export function BrandPicker({
  value,
  onChange,
  disabled,
  align = 'start',
}: {
  value: string | null
  onChange: (brandId: string | null) => void
  disabled?: boolean
  align?: 'start' | 'end'
}) {
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: () => listBrands() })
  const current = brands.find((b) => b.id === value) ?? null
  // Inline "New brand": opens the library straight into a fresh kit's editor and
  // selects it on create, so the creator never leaves the story/series flow.
  const [libOpen, setLibOpen] = useState(false)

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
        >
          <Palette className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-40 truncate">{current ? current.name : 'No brand'}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          {value === null && <Check className="size-4" />}
          <span className={value === null ? '' : 'pl-6'}>No brand</span>
        </DropdownMenuItem>
        {brands.length > 0 && <DropdownMenuSeparator />}
        {brands.map((b) => (
          <DropdownMenuItem key={b.id} onSelect={() => onChange(b.id)}>
            {value === b.id && <Check className="size-4" />}
            <span className={value === b.id ? '' : 'pl-6'}>{b.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setLibOpen(true)}>
          <Plus className="size-4" />
          New brand
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <BrandLibraryDialog open={libOpen} onOpenChange={setLibOpen} autoCreate onCreated={(id) => onChange(id)} />
    </>
  )
}
