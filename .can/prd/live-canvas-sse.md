---
spec: "Live Canvas (SSE) + Handoff Seam"
roadmap: ["NOW.3", "NOW.2 (N.2.1, N.2.2)"]
status: in-progress
author: Sal
created: 2026-06-10
depends_on: ["NOW.0 seed (shipped)", "NOW.1 installer (shipped)", "NOW.2 OAuth front-door (shipped)"]
---

# Live Canvas (SSE) + Handoff Seam

> **Batch B + A** from the roadmap reconciliation. One PR, one demo beat:
> *Claude hands you a link → you open it → the canvas builds itself live as Claude applies patches.*

## Why this, why now

The hero recording (60s side-by-side: "map Stoicism for me" → canvas populates in near-real-time) is gated on **NOW.3**. Today the canvas only *fakes* live: a 10-second poll at [`TimelineCanvas.tsx:132`](../../src/components/canvas/TimelineCanvas.tsx) (`refetchInterval: autoRefresh ? 10_000 : false`). A 10s lag is exactly the lag that kills "watch it build." The founder decision (roadmap, 2026-06-09) is **SSE primary, polling fallback** — this spec builds it.

Folded in: the **N.2.1 / N.2.2 handoff seam** (~10 lines), because it completes the *same* loop — `create_timeline` currently returns only `{id, title}` with no link for Claude to hand back, and the MCP `instructions` don't tell Claude to share it or that the canvas is live.

## Scope guardrail

Single-user, local-first Core. In-process `EventEmitter` bus (breaks with multiple workers — **acceptable**, documented). No Redis, no pub/sub infra, no WebSocket, no multi-tenant fan-out. If this starts to look like hosted real-time infrastructure, stop.

---

## Batch A — Handoff seam (do first; ~10 lines)

Both changes are in [`src/lib/mcp/server.ts`](../../src/lib/mcp/server.ts).

### A.1 — `create_timeline` returns the viewer URL (N.2.1)
- Result becomes `{ id, title, url }` where `url = ${baseUrl}/timelines/${id}`.
- `baseUrl` = `process.env.BETTER_AUTH_URL` (already the canonical app base, default `http://localhost:3001`). Add a tiny `viewerUrl(id)` helper rather than inlining.
- Tool `description` updated to: *"Create a new empty timeline. Returns its id and the viewer URL — share the URL with the user."*

### A.2 — `instructions` rewrite (N.2.2)
Rewrite the `buildMcpServer` `instructions` string to:
- Position Synek as **"your spatial memory — where research lives, visually and on a timeline."**
- Tell Claude: **after `create_timeline`, share the returned `url` with the user so they can watch it build.**
- Note the canvas **updates live** as patches apply — no need to tell the user to refresh.
- Keep the existing `apply_patch` / `ref` / undo-redo guidance.

> Forward hook (not in this batch): NOW.5 will append a "you can write stories onto moments" line here. Leave the string easy to extend.

**A acceptance:** `tools/call create_timeline` returns a `url` that resolves to the timeline; MCP `initialize` instructions mention the link-share + live behavior. Covered by a `verify:mcp`-style assertion.

---

## Batch B — Live build over SSE (the unlock)

Five units, in dependency order. N.3.4 (new-node fade-in) is **already shipped** — reused, not rebuilt.

### B.1 — In-process patch event bus (N.3.1)
**New:** `src/lib/db/events.ts` (or `src/lib/server/bus.ts`).
- A module-level singleton `EventEmitter` (survives across requests in the single Node SSR process).
- Export `emitTimelineEvent(e: TimelineEvent)` and `onTimelineEvent(timelineId, listener) → unsubscribe`.
- `TimelineEvent = { timelineId: string; kind: 'patch' | 'undo' | 'redo'; seq: number }`.
  - `seq` = the timeline's current max applied `seq` **after** the mutation (for `undo`/`redo`, the max applied seq, which may be unchanged — that's fine; the client refetches on *any* event).

**Wire into [`patches.ts`](../../src/lib/db/patches.ts):**
- `commitPatch` — after the `db.transaction(...)` returns and `patchId` is non-null (line ~213, **outside** the txn so we never emit on rollback), emit `{ timelineId, kind: 'patch', seq }`.
- `undo` / `redo` — on a `true` return, emit `{ timelineId, kind, seq: <current max applied seq> }`.

> **Why also undo/redo:** an MCP `undo` must visibly retract a node on the live canvas. They don't advance `seq`, which is exactly why the client must refetch on *any* event rather than diff seqs.

### B.2 — SSE endpoint (N.3.2)
**New route:** `src/routes/api/timelines.$id.events.ts` → `GET /api/timelines/:id/events`.
- **Auth via session cookie, NOT `requireApiKey`.** EventSource cannot set an `Authorization` header. The viewer is already Better Auth cookie-authenticated (the `/timelines/$id` route is gated). Resolve the session server-side; 401 if absent. Authorize the timeline: owner **or** `isPublic` (mirror `getGraph`'s access check — reuse that helper, don't re-derive).
- Respond with a `ReadableStream`, headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- On connect: subscribe via `onTimelineEvent(id, …)`; push each event as an SSE frame with `id: <seq>` and `data: <json>`.
- **Reconnect replay (the robustness contract):** read `Last-Event-ID` header (or `?after=<seq>`). If the timeline's current max applied `seq` is greater, immediately emit one synthetic `catch-up` event so the client refetches — no per-op replay needed (the client's refetch is authoritative). On first connect with no `Last-Event-ID`, the viewer already has the `useQuery` seed, so no synthetic event is required.
- Heartbeat: a `: ping\n\n` comment every ~25s to keep the connection alive through proxies and detect dead sockets.
- Cleanup: `request.signal`'s `abort` → unsubscribe + close. Must not leak listeners across reconnects.

### B.3 — `useTimelineStream(id)` viewer hook (N.3.3)
**New:** `src/components/canvas/useTimelineStream.ts`.
- Opens an `EventSource('/api/timelines/' + id + '/events')`.
- **v1 strategy — refetch-on-event (recommended):** on each event, `queryClient.invalidateQueries({ queryKey: ['graph', id] })` (debounced ~150ms to coalesce a burst of patches into one refetch). The existing `useQuery(['graph', id])` stays as the seed + the thing being refreshed. The canvas already keeps the camera stable across refetches (ViewportInit, [`TimelineCanvas.tsx:130`](../../src/components/canvas/TimelineCanvas.tsx)) and new nodes already fade in (N.3.4), so a refetch reads as a smooth live build — no jump, no manual refresh.
  - **This meets the intent of N.3.3** (near-real-time, no manual refresh, no full-page reload, stable camera) while staying authoritative and avoiding a client-side re-implementation of `applyOp`. The literal "incremental in-memory merge, no refetch" is logged below as an optional optimization, not v1.
- Lifecycle: open on mount/timeline-change, close on unmount. Reconnect with backoff on `error` (EventSource auto-reconnects; ensure we don't double-subscribe). The browser sends `Last-Event-ID` automatically on auto-reconnect — B.2's replay handles the gap.
- Respect the existing `autoRefresh` setting: when the user toggles live off, close the stream.

### B.4 — Swap the poll for the stream (N.3 integration)
In [`TimelineCanvas.tsx`](../../src/components/canvas/TimelineCanvas.tsx):
- Replace `refetchInterval: autoRefresh ? 10_000 : false` with a **non-polling** query (`refetchInterval: false`); drive freshness from `useTimelineStream`.
- Keep `autoRefresh` as the **"live updates"** toggle (now controls the SSE connection, not a 10s poll). Update the settings copy if it says "poll."

### B.5 — Graceful polling fallback (N.3.5)
- If `EventSource` errors and fails to reconnect within ~10s (or `EventSource` is unavailable), `useTimelineStream` flips to a polling fallback: `refetchInterval` back to ~2s on the graph query until the stream recovers.
- **This is also the correctness net for stdio-driven writes:** the standalone stdio MCP server is a *separate process* and never reaches the in-process bus, so a demo driven via stdio only converges through this fallback. The HTTP MCP path (same process) is the one that streams live — which is exactly the path the roadmap mandates for the live demo. Document this constraint in the hook's header comment.

---

## Key design decisions (call them out in the PR)

| Decision | Choice | Rationale |
|---|---|---|
| Transport | SSE, in-process `EventEmitter` | Founder decision; viewer is read-only so no duplex needed |
| SSE auth | **Session cookie**, not bearer | EventSource can't set headers; viewer is already cookie-authed |
| Client merge | **Refetch-on-event (debounced)**, not op-replay | Authoritative, no client `applyOp`, camera already stable |
| undo/redo | Emit events too | MCP undo must retract live; they don't bump `seq` |
| Reconnect | `Last-Event-ID` → synthetic catch-up → refetch | No per-op replay; refetch is the source of truth |
| stdio writes | Converge via polling fallback only | Separate process; documented, not a bug |

## Out of scope (do not build here)
- Incremental in-memory op merge (optimization; only if refetch-on-event ever shows lag at 100+ nodes).
- Multi-worker / Redis-backed bus (deferred with cloud/SaaS).
- WebSocket, presence, multi-cursor.
- Streaming anything other than graph patches (stories stream is NOW.5).

## Acceptance criteria
1. With the app running and a browser open on `/timelines/<id>`, an `apply_patch` via the **HTTP MCP endpoint** makes new nodes appear on the canvas **in < 1s**, no manual refresh.
2. An MCP `undo` retracts the node live; `redo` restores it.
3. Killing and restoring the network (DevTools offline → online) reconnects the stream and the canvas converges — no dropped patches (verify via `Last-Event-ID` replay path).
4. With `EventSource` forced to fail, the canvas still converges within ~2s (polling fallback).
5. `create_timeline` returns a `url`; opening it lands on the live canvas.
6. MCP `initialize` instructions tell Claude to share the link and that the canvas is live.
7. `bun run typecheck` + `bun run build` green. No listener leaks (open/close the timeline 10× → emitter listener count stable).

## Test plan
- **Data layer:** extend `bun run verify:mcp` — assert `create_timeline` returns `url`; assert the bus emits on `commitPatch`/`undo`/`redo` (subscribe, apply, assert event shape + seq).
- **SSE unit:** a node/tsx script that opens the SSE endpoint with a session cookie, applies a patch via the HTTP MCP path, and asserts a frame arrives with the right `seq`; assert 401 without a cookie; assert `Last-Event-ID` replay emits catch-up.
- **E2E (Playwright, `dev:test`/`e2e.db`):** open the timeline, apply a patch out-of-band, assert a new node appears without reload. (Note prior e2e gotchas: free port 3001 + `rm -rf dist` before run.)
- **Live browser pass:** Claude Preview can't hydrate the dev server — verify the live build in a normal browser session (carry-over UI debt from Substrate).

## Risks / watch-items
- **Listener leaks** on reconnect churn — the abort cleanup in B.2 is load-bearing; test it.
- **TanStack Start SSE ergonomics** — confirm the `ReadableStream` + long-lived response works under the pinned `@tanstack/react-start` 1.168.11 (don't bump it — 1.168.12 has the virtual-module regression). If the file-route handler fights the stream, this is the only real unknown; spike B.2 first.
- **Better Auth session in a route handler** — confirm the server-side session lookup helper used by `/timelines/$id` is reusable here; reuse it rather than re-implementing.

---

## Build log (2026-06-10)

**Done:**
- **Batch A (N.2.1, N.2.2)** — `create_timeline` returns `{ id, title, url }` (`viewerUrl` off `BASE_URL`); `instructions` rewritten ("spatial memory" + share the link + canvas is live). [`src/lib/mcp/server.ts`].
- **B.1 — event bus** — `src/lib/server/bus.ts`, `EventEmitter` pinned on `globalThis` (Vite SSR would otherwise split instances). Per-timeline channels, unlimited listeners, `listenerCount()` for leak checks. Wired into `commitPatch` (emit after txn commits, only on non-null patchId), `undo`, `redo` in [`src/lib/db/patches.ts`].
- **B.2 — SSE route** — `src/routes/api/timelines/$id/events.ts`. Session-cookie auth via `auth.api.getSession({ headers: request.headers })` + `canView`; bus subscription; `event: <kind>\nid: <seq>\ndata: …` frames; 25s heartbeat; `Last-Event-ID`/`?after` catch-up; abort/cancel cleanup; `x-accel-buffering: no`.
- `bun run typecheck` ✅ exit 0.

**Spike — framework risk RETIRED:** a TanStack Start file-route GET handler returns a long-lived `ReadableStream` that streams `text/event-stream` **incrementally** on pinned `@tanstack/react-start` 1.168.11. Verified live: `curl --max-time 0.8` received frame 0 immediately with the stream still open (curl exit 28); buffered-until-close would have returned empty before 1.5s. The real route registered and its handler/auth executed (bogus id → handler-issued `404 text/plain "not found"`).

**Gotcha for the implementer:** do **not** name route files with a `_`/`__` prefix — TanStack treats them as pathless/layout routes. A throwaway `api/__sse_spike.ts` matched but rendered as a *page* (HTML not-found) instead of invoking the server handler; renaming to a plain name fixed it. The real route uses **directory nesting** (`api/timelines/$id/events.ts`), the proven pattern here (mirrors `api/mcp.ts`).

**Remaining (next build session):**
- **B.3** `useTimelineStream(id)` hook — `EventSource`, debounced `invalidateQueries(['graph', id])` on each frame **and on `onopen`** (open/reconnect → authoritative refetch, makes `Last-Event-ID` belt-and-suspenders).
- **B.4** swap the 10s poll for the stream in `TimelineCanvas.tsx` (`refetchInterval: false`; `autoRefresh` now toggles the SSE connection — update settings copy).
- **B.5** polling fallback on `EventSource` failure (~2s); also the only convergence path for stdio-driven writes.
- Tests: extend `verify:mcp` (assert `create_timeline.url`; bus emits on commit/undo/redo); SSE unit (cookie → frame; no-cookie → 401; replay); e2e (patch out-of-band → node appears, no reload).

## Sal issue spec (ready to enqueue when MCP/state returns)

```
Title: Live canvas updates over SSE + MCP handoff seam
Type: feature
Horizon: now
Description:
  Replace the 10s poll with real Server-Sent Events so the canvas builds in
  near-real-time as Claude applies patches; complete the create_timeline →
  link → live-canvas handoff. Critical path for the hero recording.

  ### In scope
  - In-process patch event bus emitted from commitPatch/undo/redo
  - GET /api/timelines/:id/events SSE endpoint (session-cookie auth, replay)
  - useTimelineStream hook: refetch-on-event, debounced; polling fallback
  - create_timeline returns viewer url; MCP instructions rewrite (spatial
    memory + share link + live)

  ### Acceptance
  - apply_patch via HTTP MCP → node appears < 1s, no refresh
  - undo retracts live; reconnect replays; EventSource-fail falls back to poll
  - typecheck + build green; no listener leaks

  Spec: .can/prd/live-canvas-sse.md
Dependencies: NOW.0/1/2 (shipped). Drive demo writes via HTTP MCP, not stdio.
```
