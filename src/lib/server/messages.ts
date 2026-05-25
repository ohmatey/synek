import { createServerFn } from '@tanstack/react-start'
import { loadMessages, type StoredMessage } from '~/lib/db/messages'

// Client-callable: a thread's persisted transcript used to seed useChat on load.
export const getMessages = createServerFn({ method: 'GET' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(({ data: sessionId }): StoredMessage[] => loadMessages(sessionId))
