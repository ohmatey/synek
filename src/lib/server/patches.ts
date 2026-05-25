import { createServerFn } from '@tanstack/react-start'
import { undo, redo, historyState } from '~/lib/db/patches'

// Undo/redo return the resulting history state so the client can update button
// enablement without a second round-trip.
export const undoPatch = createServerFn({ method: 'POST' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }) => {
    undo(timelineId)
    return historyState(timelineId)
  })

export const redoPatch = createServerFn({ method: 'POST' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }) => {
    redo(timelineId)
    return historyState(timelineId)
  })

export const getHistory = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }) => historyState(timelineId))
