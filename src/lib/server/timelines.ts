import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listTimelines as dbListTimelines,
  createTimeline as dbCreateTimeline,
  renameTimeline as dbRenameTimeline,
  deleteTimeline as dbDeleteTimeline,
} from '~/lib/db/graph'
import type { TimelineRow } from '~/lib/db/schema'
import type { TimelineSummary } from '~/lib/domain/types'

const toSummary = (t: TimelineRow): TimelineSummary => ({
  id: t.id,
  title: t.title,
  description: t.description,
  createdAt: t.createdAt.getTime(),
})

export const listTimelines = createServerFn({ method: 'GET' }).handler((): TimelineSummary[] =>
  dbListTimelines().map(toSummary),
)

export const createTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: { title: string }) => z.object({ title: z.string().trim().min(1).max(200) }).parse(d))
  .handler(({ data }): TimelineSummary => toSummary(dbCreateTimeline(data.title)))

export const renameTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(({ data }) => {
    dbRenameTimeline(data.id, data.title)
    return { ok: true as const }
  })

export const deleteTimeline = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(({ data }) => {
    dbDeleteTimeline(data)
    return { ok: true as const }
  })
