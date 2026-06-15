import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listTimelines as dbListTimelines,
  createTimeline as dbCreateTimeline,
  renameTimeline as dbRenameTimeline,
  deleteTimeline as dbDeleteTimeline,
  setTimelinePublic as dbSetTimelinePublic,
  setTimelineView as dbSetTimelineView,
  setTimelineTheme as dbSetTimelineTheme,
} from '~/lib/db/graph'
import { makeRequireOwnedProject } from '~/lib/db/projects'
import { requireUser } from '~/lib/auth/session'
import { timelineThemeSchema } from '~/lib/domain/theme'
import type { TimelineRow } from '~/lib/db/schema'
import type { TimelineSummary, TimelineTheme } from '~/lib/domain/types'

const toSummary = (t: TimelineRow): TimelineSummary => ({
  id: t.id,
  title: t.title,
  description: t.description,
  createdAt: t.createdAt.getTime(),
  isPublic: t.isPublic,
  projectId: t.projectId,
})

// All timeline RPCs are scoped to the signed-in user — you only see and manage
// your own timelines. Create/rename/delete/visibility are owner-checked in the DB
// layer (a non-owner's mutation no-ops).

// Optionally narrow to one project (organizational filter WITHIN the owner —
// own-scope is still the boundary); omit projectId for all the owner's timelines.
export const listTimelines = createServerFn({ method: 'GET' })
  .inputValidator((d?: { projectId?: string }) => z.object({ projectId: z.string().optional() }).optional().parse(d))
  .handler(async ({ data }): Promise<TimelineSummary[]> => {
    const user = await requireUser()
    return dbListTimelines(user.id, data?.projectId).map(toSummary)
  })

// Create a timeline within a project: own-check the project when one is passed,
// else the db layer resolves the owner's default project (write-path invariant).
export const createTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: { title: string; projectId?: string }) =>
    z.object({ title: z.string().trim().min(1).max(200), projectId: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<TimelineSummary> => {
    const user = await requireUser()
    if (data.projectId) makeRequireOwnedProject(user.id)(data.projectId)
    return toSummary(dbCreateTimeline(data.title, user.id, data.projectId))
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

// Owner-only: REPLACE the timeline's theme wholesale (no deep merge — the client
// sends the full object it wants); pass null to clear back to the default look.
export const setTimelineTheme = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; theme: TimelineTheme | null }) =>
    z.object({ id: z.string(), theme: timelineThemeSchema.nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbSetTimelineTheme(data.id, user.id, data.theme)
    return { ok: true as const }
  })
