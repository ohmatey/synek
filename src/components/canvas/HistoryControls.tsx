import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { getHistory, redoPatch, undoPatch } from '~/lib/server/patches'
import { floatChip } from './chrome'

type HistoryState = { canUndo: boolean; canRedo: boolean }
type HistoryFn = (opts: { data: string }) => Promise<HistoryState>

export function HistoryControls({ timelineId }: { timelineId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['history', timelineId],
    queryFn: () => getHistory({ data: timelineId }),
  })
  const canUndo = data?.canUndo ?? false
  const canRedo = data?.canRedo ?? false

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
            className="size-7"
            aria-label="Undo"
            onClick={() => run(undoPatch)}
            disabled={!canUndo}
          >
            <Undo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo · ⌘Z</TooltipContent>
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
