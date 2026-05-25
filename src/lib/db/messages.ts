import { asc, eq } from 'drizzle-orm'
import { db } from './index'
import { messages, type MessageRow } from './schema'

// Minimal UIMessage shape we persist/restore (id + role + parts is all useChat
// needs to rehydrate a thread). `parts` is opaque AI-SDK JSON passed straight
// through DB → RPC → useChat; typed `any[]` so the server-fn serializer accepts
// it (it rejects `unknown`) without us re-declaring the whole UIMessagePart union.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoredMessage = { id: string; role: 'system' | 'user' | 'assistant'; parts: any[] }

export function loadMessages(timelineId: string): StoredMessage[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.timelineId, timelineId))
    .orderBy(asc(messages.seq))
    .all()
    .map((m: MessageRow) => ({ id: m.messageId, role: m.role, parts: m.parts }))
}

// Replace the timeline's transcript with the latest full list. The AI SDK hands
// us the complete updated message list on each turn, so a full rewrite keeps it
// simple and idempotent (no per-message diffing).
export function saveMessages(timelineId: string, msgs: StoredMessage[]): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.timelineId, timelineId)).run()
    msgs.forEach((m, i) => {
      tx.insert(messages).values({ timelineId, messageId: m.id, seq: i, role: m.role, parts: m.parts }).run()
    })
  })
}
