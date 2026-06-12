import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Plus } from 'lucide-react'

// A dashed "invitation" ghost — the map showing a hole and offering to fill it
// (NEXT.5 Tier 2 — docs/product/prd/next5-tier2-alive-canvas.md). One presenter for
// every variant: an axis dead zone ('gap'), a thin swimlane ('lane'), or a bare era
// ('era'). It's a dumb presenter — the canvas formats the copy and supplies onFill
// (which opens the shared PromptDialog). Deliberately unlike a real node: dashed,
// muted, no solid fill.
export type InvitationVariant = 'gap' | 'lane' | 'era'

export type InvitationData = {
  variant: InvitationVariant
  title: string
  subtitle: string
  cta: string
  onFill: () => void
  cardWidth: number
}

function InvitationNodeImpl({ data }: NodeProps) {
  const { title, subtitle, cta, onFill, cardWidth } = data as InvitationData
  return (
    <button
      type="button"
      onClick={onFill}
      // nodrag/nopan: let the click reach the button instead of starting a canvas pan.
      className="nodrag nopan flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-muted-foreground/40 bg-background/50 px-3 py-2.5 text-center backdrop-blur-sm transition-colors hover:border-muted-foreground/70 hover:bg-background/80"
      style={{ width: cardWidth }}
      aria-label={`${cta}: ${title} ${subtitle}`}
    >
      <span className="text-xs font-medium text-foreground/80">{title}</span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        <Plus className="size-3" />
        {cta}
      </span>
    </button>
  )
}

export const InvitationNode = memo(InvitationNodeImpl)
