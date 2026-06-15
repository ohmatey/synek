import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { moveTimelineToProject } from '~/lib/server/projects'
import { capture } from '~/lib/posthog/client'

// The move-to-project gesture (local-126), shared by the story card and timeline
// card overflow menus. A timeline carries its stories + entities, so moving the
// timeline moves everything anchored to it; the toast names the moved item and
// its destination.
//
// The move is NOT a Patch (ADR 0002 D9 — project membership is metadata). After it
// resolves we invalidate the projects + timelines + home-stories queries so the
// hero re-picks and the rows re-scope (per the RPC's UI note). The confirmation IS
// the undo toast (the move is cheap + reversible): "Undo" calls the same RPC again
// with the ORIGINAL project id, which the caller captured before the move.
export function useMoveTimeline() {
  const qc = useQueryClient()

  // Re-fetch everything the home reads off of after a membership change.
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['projects'] }),
      qc.invalidateQueries({ queryKey: ['timelines'] }),
      qc.invalidateQueries({ queryKey: ['home-stories'] }),
    ])
  }, [qc])

  return useCallback(
    async (args: {
      timelineId: string
      // The project the timeline currently lives in (for the undo path). May be
      // null/unknown for a legacy null-project timeline — undo is then suppressed.
      fromProjectId: string | null
      targetProjectId: string
      targetProjectTitle: string
      // What the toast names — usually the timeline title; for a story card, the
      // story title reads better ("'The Fall of the Republic' moved to …").
      itemLabel: string
    }) => {
      if (args.targetProjectId === args.fromProjectId) return
      try {
        await moveTimelineToProject({
          data: { timelineId: args.timelineId, targetProjectId: args.targetProjectId },
        })
        await invalidate()
        capture('home_move_to_project', {
          from_project_id: args.fromProjectId ?? undefined,
          to_project_id: args.targetProjectId,
        })
        toast.success(`“${args.itemLabel}” moved to ${args.targetProjectTitle}`, {
          action: args.fromProjectId
            ? {
                label: 'Undo',
                onClick: () => {
                  void (async () => {
                    try {
                      await moveTimelineToProject({
                        data: { timelineId: args.timelineId, targetProjectId: args.fromProjectId! },
                      })
                      await invalidate()
                    } catch {
                      toast.error('Could not undo the move.')
                    }
                  })()
                },
              }
            : undefined,
        })
      } catch {
        toast.error('Could not move to that project.')
      }
    },
    [invalidate],
  )
}
