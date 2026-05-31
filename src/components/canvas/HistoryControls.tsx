import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IconButton } from '@synek/ui'
import { getHistory, redoPatch, undoPatch } from '~/lib/server/patches'

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
    <div className="inline-flex items-center gap-1">
      <IconButton
        aria-label="Undo"
        title="Undo (⌘Z)"
        size="sm"
        onClick={() => run(undoPatch)}
        disabled={!canUndo}
      >
        ↶
      </IconButton>
      <IconButton
        aria-label="Redo"
        title="Redo (⌘⇧Z)"
        size="sm"
        onClick={() => run(redoPatch)}
        disabled={!canRedo}
      >
        ↷
      </IconButton>
    </div>
  )
}
