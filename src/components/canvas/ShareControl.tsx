import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, Lock } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/utils'
import { CopyButton } from '~/components/home/CopyButton'
import { setTimelineVisibility } from '~/lib/server/timelines'
import { floatChip } from './chrome'

// Owner-only sharing: toggle public/private and, when public, copy the share URL.
// Lives at the far-right of the canvas top bar, next to the account menu.
export function ShareControl({ timelineId, isPublic }: { timelineId: string; isPublic: boolean }) {
  const qc = useQueryClient()
  const [pub, setPub] = useState(isPublic)
  const [busy, setBusy] = useState(false)

  useEffect(() => setPub(isPublic), [isPublic])

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/timelines/${timelineId}` : ''

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const next = !pub
      await setTimelineVisibility({ data: { id: timelineId, isPublic: next } })
      setPub(next)
      void qc.invalidateQueries({ queryKey: ['graph', timelineId] })
      void qc.invalidateQueries({ queryKey: ['timelines'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={pub ? 'default' : 'outline'} className={cn('h-8', !pub && floatChip)}>
          {pub ? <Link2 /> : <Lock />}
          {pub ? 'Public' : 'Private'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={pub}
            disabled={busy}
            onChange={() => void toggle()}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Anyone with the link can view</span>
            <span className="text-xs text-muted-foreground">
              Read-only — viewers can’t edit your timeline.
            </span>
          </span>
          {busy && <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />}
        </label>
        {pub && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {shareUrl}
            </code>
            <CopyButton text={shareUrl} variant="outline" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
