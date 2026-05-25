import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listSessions as dbListSessions,
  createSession as dbCreateSession,
  renameSession as dbRenameSession,
  deleteSession as dbDeleteSession,
} from '~/lib/db/sessions'
import type { ChatSessionRow } from '~/lib/db/schema'
import type { ChatSessionSummary } from '~/lib/domain/types'

const toSummary = (s: ChatSessionRow): ChatSessionSummary => ({
  id: s.id,
  timelineId: s.timelineId,
  title: s.title,
  createdAt: s.createdAt.getTime(),
  updatedAt: s.updatedAt.getTime(),
})

export const listSessions = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => z.string().parse(timelineId))
  .handler(({ data: timelineId }): ChatSessionSummary[] => dbListSessions(timelineId).map(toSummary))

export const createSession = createServerFn({ method: 'POST' })
  .inputValidator((d: { timelineId: string; title?: string }) =>
    z.object({ timelineId: z.string(), title: z.string().trim().min(1).max(200).optional() }).parse(d),
  )
  .handler(({ data }): ChatSessionSummary => toSummary(dbCreateSession(data.timelineId, data.title)))

export const renameSession = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(({ data }) => {
    dbRenameSession(data.id, data.title)
    return { ok: true as const }
  })

export const deleteSession = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(({ data }) => {
    dbDeleteSession(data)
    return { ok: true as const }
  })
