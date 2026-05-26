import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from './index'
import { chatSessions, messages, type ChatSessionRow } from './schema'

export const DEFAULT_SESSION_TITLE = 'New conversation'

// Threads of a timeline, newest activity first — drives the History list.
export function listSessions(timelineId: string): ChatSessionRow[] {
  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.timelineId, timelineId))
    .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.createdAt))
    .all()
}

export function getSession(id: string): ChatSessionRow | undefined {
  return db.select().from(chatSessions).where(eq(chatSessions.id, id)).get()
}

export function createSession(timelineId: string, title: string = DEFAULT_SESSION_TITLE): ChatSessionRow {
  return db.insert(chatSessions).values({ timelineId, title }).returning().get()
}

export function renameSession(id: string, title: string): void {
  db.update(chatSessions).set({ title, updatedAt: new Date() }).where(eq(chatSessions.id, id)).run()
}

// Bump activity so the thread floats to the top of History after a turn.
export function touchSession(id: string): void {
  db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, id)).run()
}

// The session_id FK was added via ALTER (no ON DELETE cascade in SQLite), so
// drop the thread's messages explicitly before the session row.
export function deleteSession(id: string): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.sessionId, id)).run()
    tx.delete(chatSessions).where(eq(chatSessions.id, id)).run()
  })
}

// One-time adoption of transcripts saved before threads existed: give each
// timeline that has orphan (null-session) messages a session and assign them.
// Idempotent — a no-op once every message belongs to a session.
export function backfillSessions(): void {
  const orphans = db
    .selectDistinct({ timelineId: messages.timelineId })
    .from(messages)
    .where(isNull(messages.sessionId))
    .all()
  if (orphans.length === 0) return
  db.transaction((tx) => {
    for (const { timelineId } of orphans) {
      const session = tx.insert(chatSessions).values({ timelineId, title: 'Conversation' }).returning().get()
      tx.update(messages)
        .set({ sessionId: session.id })
        .where(and(eq(messages.timelineId, timelineId), isNull(messages.sessionId)))
        .run()
    }
  })
}
