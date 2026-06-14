import { createServerFn } from '@tanstack/react-start'
import { undo, redo, historyState } from '~/lib/db/patches'
import { getTimelineMeta } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'

// Undo/redo mutate the timeline, so they're owner-only.
async function assertOwnsTimeline(timelineId: string): Promise<void> {
  const user = await requireUser()
  const meta = getTimelineMeta(timelineId)
  if (!meta || meta.ownerId !== user.id) throw new Error('forbidden: not your timeline')
}

// Undo/redo return the resulting history state so the client can update button
// enablement without a second round-trip.
export const undoPatch = createServerFn({ method: 'POST' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }) => {
    await assertOwnsTimeline(timelineId)
    undo(timelineId)
    return historyState(timelineId)
  })

export const redoPatch = createServerFn({ method: 'POST' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }) => {
    await assertOwnsTimeline(timelineId)
    redo(timelineId)
    return historyState(timelineId)
  })

// History exposes per-timeline state, so it's owner-only too — the same guard as
// undo/redo (multi-tenant: a non-owner must not read another user's history).
export const getHistory = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(async ({ data: timelineId }) => {
    await assertOwnsTimeline(timelineId)
    return historyState(timelineId)
  })
