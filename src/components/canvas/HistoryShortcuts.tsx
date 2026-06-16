import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { redoPatch, undoPatch } from '~/lib/server/patches'

// Headless undo/redo: binds ⌘Z / ⌘⇧Z (Ctrl on non-mac) to the per-timeline patch
// history — the core Patch undo/redo mechanic. The visible toolbar buttons were
// removed; keyboard access stays. Mounted by the canvas only for the owner (a
// read-only viewer can't write patches). Renders nothing.
export function HistoryShortcuts({ timelineId }: { timelineId: string }) {
  const qc = useQueryClient()
  useEffect(() => {
    async function run(fn: (opts: { data: string }) => Promise<unknown>) {
      await fn({ data: timelineId })
      await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    }
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      void run(e.shiftKey ? redoPatch : undoPatch)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timelineId, qc])
  return null
}
