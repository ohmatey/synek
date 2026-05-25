// Data-layer check for chat threads (sessions). Run under Node (better-sqlite3
// needs the Node ABI): `bunx tsx scripts/verify-sessions.ts`. Creates a throwaway
// timeline, exercises the session helpers, then cleans up.
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { messages, type MessageRow } from '../src/lib/db/schema'
import { createTimeline, deleteTimeline } from '../src/lib/db/graph'
import { listSessions, createSession, deleteSession, touchSession, backfillSessions } from '../src/lib/db/sessions'
import { loadMessages, saveMessages } from '../src/lib/db/messages'

let pass = 0
function check(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`)
  pass++
  console.log(`  ✓ ${label}`)
}
function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const tl = createTimeline(`verify-sessions ${new Date().toISOString()}`)
try {
  // Two threads on one timeline (b created strictly after a).
  const a = createSession(tl.id, 'Thread A')
  sleep(3)
  const b = createSession(tl.id, 'Thread B')
  check(a.id !== b.id, 'two sessions get distinct ids')

  // Distinct transcripts per thread.
  saveMessages(a.id, tl.id, [{ id: 'a1', role: 'user', parts: [{ type: 'text', text: 'alpha' }] }])
  saveMessages(b.id, tl.id, [
    { id: 'b1', role: 'user', parts: [{ type: 'text', text: 'beta' }] },
    { id: 'b2', role: 'assistant', parts: [{ type: 'text', text: 'beta reply' }] },
  ])

  // Isolation: each thread loads only its own ordered messages.
  const ma = loadMessages(a.id)
  const mb = loadMessages(b.id)
  check(ma.length === 1 && ma[0].id === 'a1', 'thread A loads only its own message')
  check(mb.length === 2 && mb[0].id === 'b1' && mb[1].id === 'b2', 'thread B loads its own ordered messages')

  // Listing: most-recent activity first.
  touchSession(b.id)
  const list = listSessions(tl.id)
  check(list.length === 2, 'listSessions returns both threads')
  check(list[0].id === b.id, 'most-recently-active thread is first')

  // Delete drops the thread + cascades its messages; the other thread survives.
  deleteSession(a.id)
  check(listSessions(tl.id).length === 1, 'deleteSession removes the thread')
  check(loadMessages(a.id).length === 0, 'deleted thread has no messages (explicit cascade)')
  check(loadMessages(b.id).length === 2, "other thread's messages survive")

  // Backfill adopts pre-sessions (null-session) rows into a fresh session.
  db.insert(messages)
    .values({ timelineId: tl.id, messageId: 'legacy1', seq: 0, role: 'user', parts: [{ type: 'text', text: 'legacy' }] })
    .run()
  const before = listSessions(tl.id).length
  backfillSessions()
  check(listSessions(tl.id).length === before + 1, 'backfill creates a session for orphan messages')
  const orphans = db
    .select()
    .from(messages)
    .where(eq(messages.timelineId, tl.id))
    .all()
    .filter((m: MessageRow) => m.sessionId === null)
  check(orphans.length === 0, 'no messages left without a session after backfill')

  console.log(`\nAll ${pass} checks passed.`)
} finally {
  deleteTimeline(tl.id)
  console.log('Cleaned up verify timeline.')
}
