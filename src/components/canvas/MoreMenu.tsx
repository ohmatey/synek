import { MoreHorizontal, Share2, SlidersHorizontal } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'
import { floatChip } from './chrome'

// The "⋯ More" overflow: the secondary chrome (display settings, share/export)
// folded behind one button so the top bar stays a tight, always-reachable set —
// especially on mobile, where the flat toolbar would otherwise clip off-screen.
// It only opens the dialogs (which live, controlled, in TimelineCanvas); the
// items are gated the same way the inline chips used to be.
export function MoreMenu({
  canSettings,
  canShare,
  onOpenSettings,
  onOpenShare,
}: {
  canSettings: boolean
  canShare: boolean
  onOpenSettings: () => void
  onOpenShare: () => void
}) {
  if (!canSettings && !canShare) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(floatChip, 'size-8')}
          aria-label="More"
          title="More"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canSettings && (
          <DropdownMenuItem onSelect={onOpenSettings}>
            <SlidersHorizontal />
            Display settings
          </DropdownMenuItem>
        )}
        {canShare && (
          <DropdownMenuItem onSelect={onOpenShare}>
            <Share2 />
            Share &amp; export
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
