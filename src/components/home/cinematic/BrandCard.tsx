import { useState } from 'react'
import { Palette } from 'lucide-react'
import type { BrandSummary } from '~/lib/server/brands'
import { BrandManagerDialog } from '~/components/brand/BrandManagerDialog'

// One brand kit in the "Brand kits" home row (ask #6). A compact card: a palette
// swatch strip (or a placeholder), the kit name, and its tagline. Clicking it opens
// the brand manager drilled into this kit's editor (reusing the slice-2 manager).
export function BrandCard({
  brand,
  // The active project (if the page is filtered) so the editor offers "link to
  // this project". null on the all-scope home.
  linkProject,
}: {
  brand: BrandSummary
  linkProject?: { id: string; title: string } | null
}) {
  const [open, setOpen] = useState(false)
  const colors = brand.kit?.colors ?? []
  const tagline = brand.kit?.tagline || (brand.kit ? 'Brand kit' : 'Empty — click to author')

  return (
    <article className="ch-brandcard">
      <button
        type="button"
        className="ch-brandcard-open"
        onClick={() => setOpen(true)}
        aria-label={`Edit brand kit “${brand.name}”`}
      >
        <span className="ch-brandcard-swatches" aria-hidden="true">
          {colors.length > 0 ? (
            colors.slice(0, 5).map((c, i) => (
              <span key={i} className="ch-brandcard-swatch" style={{ backgroundColor: c }} />
            ))
          ) : (
            <span className="ch-brandcard-swatch-empty">
              <Palette />
            </span>
          )}
        </span>
        <span className="ch-brandcard-body">
          <span className="ch-brandcard-name">{brand.name}</span>
          <span className="ch-brandcard-tagline">{tagline}</span>
        </span>
      </button>

      <BrandManagerDialog
        open={open}
        onOpenChange={setOpen}
        initialBrandId={brand.id}
        linkProject={linkProject ?? null}
      />
    </article>
  )
}
