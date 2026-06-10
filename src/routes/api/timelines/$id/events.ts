import { createFileRoute } from '@tanstack/react-router'
import { and, eq, max } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { db } from '~/lib/db'
import { patches } from '~/lib/db/schema'
import { getTimelineMeta, canView } from '~/lib/db/graph'
import { onTimelineEvent, type TimelineEvent } from '~/lib/server/bus'

// Live updates (NOW.3 / B.2). The viewer opens an EventSource here and the server
// pushes one frame per committed patch (and per undo/redo). The client refetches
// the graph on each frame — authoritative, no client-side op replay.
//
// AUTH: via the Better Auth SESSION COOKIE, not the Bearer guard — an EventSource
// cannot set an Authorization header. The viewer is already cookie-authenticated.
const maxAppliedSeq = (timelineId: string): number =>
  db
    .select({ m: max(patches.seq) })
    .from(patches)
    .where(and(eq(patches.timelineId, timelineId), eq(patches.status, 'applied')))
    .get()?.m ?? 0

export const Route = createFileRoute('/api/timelines/$id/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const timelineId = params.id
        const session = await auth.api.getSession({ headers: request.headers })
        const meta = getTimelineMeta(timelineId)
        if (!meta) return new Response('not found', { status: 404 })
        if (!canView(meta, session?.user?.id ?? null)) {
          return new Response('unauthorized', { status: 401 })
        }

        const encoder = new TextEncoder()
        // On reconnect the browser echoes the last frame id; `?after=` is the
        // manual/polling-bridge form. Either lets us detect a missed patch.
        const after = Number(
          request.headers.get('last-event-id') ??
            new URL(request.url).searchParams.get('after') ??
            '0',
        )

        let unsubscribe: (() => void) | null = null
        let heartbeat: ReturnType<typeof setInterval> | undefined
        const cleanup = () => {
          unsubscribe?.()
          unsubscribe = null
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = undefined
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enqueue = (chunk: string) => {
              try {
                controller.enqueue(encoder.encode(chunk))
              } catch {
                // Controller already closed (client gone) — stop pushing.
                cleanup()
              }
            }
            const send = (e: TimelineEvent) =>
              enqueue(`event: ${e.kind}\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)

            // Reconnect replay: if a patch landed while the client was away, nudge
            // an immediate refetch. The client refetches on this frame too.
            const current = maxAppliedSeq(timelineId)
            if (after > 0 && current > after) {
              enqueue(`event: catchup\ndata: ${JSON.stringify({ timelineId, seq: current })}\n\n`)
            }

            unsubscribe = onTimelineEvent(timelineId, send)
            // Keep-alive comment so proxies don't close an idle stream and so a
            // dead socket surfaces as an enqueue failure → cleanup.
            heartbeat = setInterval(() => enqueue(': ping\n\n'), 25_000)
          },
          cancel() {
            cleanup()
          },
        })

        // Belt-and-suspenders: also tear down when the request aborts.
        request.signal.addEventListener('abort', cleanup)

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            // Disable proxy buffering (nginx) so frames flush immediately.
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
