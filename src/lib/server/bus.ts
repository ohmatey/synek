import { EventEmitter } from 'node:events'

// In-process patch event bus (NOW.3 / B.1). The commit path emits here after a
// patch lands; the SSE route (`/api/timelines/:id/events`) subscribes and pushes
// to connected viewers. Single-process only — breaks with multiple workers, which
// is acceptable for the single-user local Core (see CLAUDE.md guardrail).
//
// stdio writes run in a SEPARATE process and never reach this bus; those converge
// only via the viewer's polling fallback (B.5). The live path is the HTTP MCP
// endpoint, which shares this process with the viewer.

export type TimelineEvent = {
  timelineId: string
  // `patch`/`undo`/`redo` are graph mutations; `story` is a write_story commit
  // (separate from the Patch stack). Clients refetch on ANY kind.
  kind: 'patch' | 'undo' | 'redo' | 'story'
  // The patch seq involved. For `patch`, the newly-committed seq; for undo/redo,
  // the seq of the patch that flipped; for `story`, the timeline's current max
  // applied seq (so it never rewinds Last-Event-ID). Clients refetch on ANY
  // event, so this is for SSE frame ids / debugging, not load-bearing.
  seq: number
}

// Vite SSR / HMR can re-evaluate this module per request, which would give the
// write path and the SSE route different emitter instances and silently drop
// every live update. Pin one emitter on globalThis so the whole process shares it.
const g = globalThis as unknown as { __synekTimelineBus?: EventEmitter }
const bus = (g.__synekTimelineBus ??= new EventEmitter())
// Many concurrent viewers across many timelines — no artificial listener ceiling.
bus.setMaxListeners(0)

const channel = (timelineId: string) => `tl:${timelineId}`

export function emitTimelineEvent(e: TimelineEvent): void {
  bus.emit(channel(e.timelineId), e)
}

// Subscribe to one timeline's events. Returns an unsubscribe fn — the SSE route
// MUST call it on stream cancel/abort or listeners leak across reconnects.
export function onTimelineEvent(timelineId: string, listener: (e: TimelineEvent) => void): () => void {
  const ch = channel(timelineId)
  bus.on(ch, listener)
  return () => {
    bus.off(ch, listener)
  }
}

// Test/diagnostic hook: live listener count for a timeline channel (leak checks).
export function listenerCount(timelineId: string): number {
  return bus.listenerCount(channel(timelineId))
}
