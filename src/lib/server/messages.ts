import { createServerFn } from '@tanstack/react-start'
import { loadMessages, type StoredMessage } from '~/lib/db/messages'

// Client-callable: the persisted transcript used to seed useChat on load.
export const getMessages = createServerFn({ method: 'GET' })
  .inputValidator((timelineId: string) => timelineId)
  .handler(({ data: timelineId }): StoredMessage[] => loadMessages(timelineId))
