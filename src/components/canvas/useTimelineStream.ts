import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Live canvas updates over Server-Sent Events (NOW.3 — N.3.3 + N.3.5).
//
// The server route `/api/timelines/:id/events` pushes a thin envelope per
// committed patch/undo/redo (and per write_story `story` frame). The payload
// carries NO graph data — so on ANY frame we just invalidate the ['graph', id]
// query (and the ['story'] family on a story frame, to refresh an open reader)
// and let React Query refetch the authoritative graph. New nodes then fade/glow
// in via the canvas's existing arrival animation (N.3.4), no extra work.
//
// Convergence model:
//   • Same-process writes (the HTTP MCP endpoint, manual edits) emit on the
//     in-process bus → an SSE frame arrives → near-instant refetch. This is the
//     "watch it build" path the hero demo rides.
//   • Separate-process writes (the stdio MCP server, e.g. Claude Desktop) never
//     reach this process's bus, so NO frame arrives. A slow BASELINE poll runs
//     whenever live updates are on, so those still converge (~10s); the SSE frame
//     just makes same-process writes feel instant on top of that floor.
//   • If an established SSE stream drops, we tighten to a faster FALLBACK poll
//     until it reconnects (the browser auto-reconnects and replays Last-Event-ID).
//
// Two traps this is built around:
//   1. Frames are NAMED SSE events ('patch'|'undo'|'redo'|'story'|'catchup'), so
//      EventSource.onmessage NEVER fires — we addEventListener per name.
//   2. A non-2xx response (401/404 on a private/missing timeline) makes the
//      browser "fail the connection": one error, readyState=CLOSED, NO reconnect.
//      We must not poll that dead-end endpoint — hence the readyState guard, and
//      the baseline only starts once a connection actually opens.

const STREAM_EVENTS = ['patch', 'undo', 'redo', 'catchup'] as const
// Coalesce a burst of frames (e.g. a multi-op apply_patch) into one refetch.
const INVALIDATE_DEBOUNCE_MS = 150
// Floor poll while live + the stream is healthy — catches separate-process (stdio)
// writes the in-process bus can't see.
const BASELINE_POLL_MS = 10_000
// Faster poll while an established SSE stream is down, for quicker convergence (N.3.5).
const FALLBACK_POLL_MS = 2_000
// How long the stream may stay down before we tighten to the faster poll.
const FALLBACK_AFTER_MS = 10_000

export function useTimelineStream({
  timelineId,
  enabled,
}: {
  timelineId: string
  enabled: boolean
}): { pollingInterval: number | false } {
  const queryClient = useQueryClient()
  const [pollingInterval, setPollingInterval] = useState<number | false>(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setPollingInterval(false)
      return
    }
    // No EventSource (ancient browser) → rely entirely on the baseline poll.
    if (typeof EventSource === 'undefined') {
      setPollingInterval(BASELINE_POLL_MS)
      return
    }

    let debounce: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    const invalidateGraph = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['graph', timelineId] })
      }, INVALIDATE_DEBOUNCE_MS)
    }
    // A story frame also refreshes an already-open node-detail reader, which reads
    // the story via a separate ['story', nodeId] query.
    const onStory = () => {
      invalidateGraph()
      void queryClient.invalidateQueries({ queryKey: ['story'] })
    }

    // Same-origin relative URL → the browser attaches the Better Auth session
    // cookie automatically (EventSource can't set Authorization, which is exactly
    // why the route is cookie-authed).
    const es = new EventSource(`/api/timelines/${timelineId}/events`)

    const onOpen = () => {
      // (Re)connected: cancel any pending fallback, return to the baseline floor,
      // and refetch once to close any gap from before the connection opened.
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      setPollingInterval(BASELINE_POLL_MS)
      invalidateGraph()
    }
    const onError = () => {
      // "Fail the connection" (e.g. 401/404) closes the stream permanently with no
      // reconnect — don't poll a dead-end endpoint (the baseline never started for
      // it because onOpen never fired).
      if (es.readyState === EventSource.CLOSED) return
      // Transient drop: the browser auto-reconnects; tighten the poll only if it
      // stays down past the window (don't fight the built-in reconnect).
      if (fallbackTimer) return
      fallbackTimer = setTimeout(() => setPollingInterval(FALLBACK_POLL_MS), FALLBACK_AFTER_MS)
    }

    es.addEventListener('open', onOpen)
    es.addEventListener('error', onError)
    es.addEventListener('story', onStory)
    for (const name of STREAM_EVENTS) es.addEventListener(name, invalidateGraph)

    return () => {
      es.removeEventListener('open', onOpen)
      es.removeEventListener('error', onError)
      es.removeEventListener('story', onStory)
      for (const name of STREAM_EVENTS) es.removeEventListener(name, invalidateGraph)
      es.close()
      if (debounce) clearTimeout(debounce)
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [timelineId, enabled, queryClient])

  return { pollingInterval }
}
