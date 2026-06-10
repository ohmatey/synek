import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { getHistory, redoPatch, undoPatch } from '~/lib/server/patches'
import { floatChip } from './chrome'

type HistoryState = { canUndo: boolean; canRedo: boolean; appliedCount: number }
type HistoryFn = (opts: { data: string }) => Promise<HistoryState>

export function HistoryControls({ timelineId }: { timelineId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['history', timelineId],
    queryFn: () => getHistory({ data: timelineId }),
  })
  const canUndo = data?.canUndo ?? false
  const canRedo = data?.canRedo ?? false
  const appliedCount = data?.appliedCount ?? 0

  async function run(fn: HistoryFn) {
    const state = await fn({ data: timelineId })
    qc.setQueryData(['history', timelineId], state)
    await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      void run(e.shiftKey ? redoPatch : undoPatch)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineId])

  return (
    <div className={cn(floatChip, 'inline-flex items-center gap-1 p-1')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-7"
            aria-label={`Undo (${appliedCount} patch${appliedCount === 1 ? '' : 'es'})`}
            onClick={() => run(undoPatch)}
            disabled={!canUndo}
          >
            <Undo2 />
            {appliedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-muted px-0.5 text-[9px] font-bold tabular-nums text-muted-foreground">
                {appliedCount > 99 ? '99+' : appliedCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Undo · ⌘Z{appliedCount > 0 ? ` · ${appliedCount} patch${appliedCount === 1 ? '' : 'es'}` : ''}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Redo"
            onClick={() => run(redoPatch)}
            disabled={!canRedo}
          >
            <Redo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo · ⌘⇧Z</TooltipContent>
      </Tooltip>
    </div>
  )
}
