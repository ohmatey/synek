import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listTimelines as dbListTimelines,
  createTimeline as dbCreateTimeline,
  renameTimeline as dbRenameTimeline,
  deleteTimeline as dbDeleteTimeline,
  setTimelinePublic as dbSetTimelinePublic,
  setTimelineView as dbSetTimelineView,
} from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
import type { TimelineRow } from '~/lib/db/schema'
import type { TimelineSummary } from '~/lib/domain/types'

const toSummary = (t: TimelineRow): TimelineSummary => ({
  id: t.id,
  title: t.title,
  description: t.description,
  createdAt: t.createdAt.getTime(),
  isPublic: t.isPublic,
})

// All timeline RPCs are scoped to the signed-in user — you only see and manage
// your own timelines. Create/rename/delete/visibility are owner-checked in the DB
// layer (a non-owner's mutation no-ops).

export const listTimelines = createServerFn({ method: 'GET' }).handler(async (): Promise<TimelineSummary[]> => {
  const user = await requireUser()
  return dbListTimelines(user.id).map(toSummary)
})

export const createTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: { title: string }) => z.object({ title: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data }): Promise<TimelineSummary> => {
    const user = await requireUser()
    return toSummary(dbCreateTimeline(data.title, user.id))
  })

export const renameTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbRenameTimeline(data.id, data.title, user.id)
    return { ok: true as const }
  })

export const deleteTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbDeleteTimeline(data, user.id)
    return { ok: true as const }
  })

export const setTimelineVisibility = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; isPublic: boolean }) =>
    z.object({ id: z.string(), isPublic: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbSetTimelinePublic(data.id, user.id, data.isPublic)
    return { ok: true as const, isPublic: data.isPublic }
  })

// Owner-only: save the current time-axis scale as this timeline's default,
// applied on open for devices without a local override.
export const setTimelineView = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; view: { pxPerDay: number; collapseGaps: boolean } }) =>
    z
      .object({
        id: z.string(),
        view: z.object({ pxPerDay: z.number().positive(), collapseGaps: z.boolean() }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbSetTimelineView(data.id, user.id, data.view)
    return { ok: true as const }
  })
