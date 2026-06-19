---
phase: M.1
title: "Activation funnel instrumentation"
status: proposed
era: "Monetization groundwork (measure-first)"
updated: 2026-06-19
links:
  - docs/product/prd/understand-app.md
  - docs/product/prd/usage-ledger-rate-limit.md
  - docs/product/roadmap.md
---

# M.1 — Activation funnel instrumentation

> **The single number.** Of every person who signs up, what fraction connects a key?
> That drop-off is the clearest signal we have on whether "bring your own AI" is a
> viable dev-first wedge or whether the managed seat is the only real business. You
> cannot set a price on a split you haven't measured.

## Why this, why now

The seat model is decided (`docs/finance/synek-financial-model.xlsx`,
`docs/product/roadmap.md §M`): two SKUs — BYO seat (devs/prosumers, near-zero
inference COGS) and managed seat (non-tech creators, inference bundled). The entire
pricing strategy turns on one empirical question: do users who sign up actually connect
a key, or do they need the managed path? The `key_connected` drop-off in the M.1
funnel is the number that answers it.

METER (`docs/product/prd/usage-ledger-rate-limit.md`) ships the usage ledger and the
per-run COGS machinery (M.5). M.1 is its behavioral twin: five ordered steps that
reveal where people fall out of the value loop. Together they give the founder the
answers before pricing anything.

### What the codebase already has vs. what is missing

This PRD is grounded in a direct audit of the code paths for all five funnel steps.
The findings:

| Step | Event | Status | Evidence |
|---|---|---|---|
| 1 | `signup` | **MISSING** | `src/components/home/AuthForms.tsx` calls `signUp.email()` (line 44) with no `capture()` call. No Better Auth `databaseHooks` wired in `src/lib/auth/index.ts`. No server-side `captureServer` on the auth handler. |
| 2 | `key_connected` | **MISSING** | `src/components/account/AgentKeyCard.tsx` calls `setOpenRouterKey` mutation (line 106) with no `capture()` in `onSuccess`. `src/lib/server/user-settings.ts` has no `captureServer` call. |
| 3 | `timeline_created` | **PARTIAL** | `src/components/home/NewTimelineDialog.tsx:67` fires `capture('timeline_created', { timeline_id })` on the UI path only. The MCP `create_timeline` tool in `src/lib/mcp/registry.ts` emits only `mcp_tool_called { tool: 'create_timeline' }` via the `register` wrapper in `src/lib/mcp/server.ts` — not a distinct `timeline_created` event. Both paths should emit the same canonical event. |
| 4 | `story_written` | **MISSING** | `write_story` in `src/lib/mcp/registry.ts` emits `mcp_tool_called { tool: 'write_story', segments, cast, … }` via the `register` wrapper (lines 119, 136 in `server.ts`) — granular engagement data exists, but no distinct `story_written` event that can stand as a funnel step. The in-app `NewStoryDialog` path has no `captureServer` call either. |
| 5 | `story_shared` | **EXISTS** | `src/components/public/ShareStoryButton.tsx:39` fires `capture('story_shared', { story_id })` on the first-share path (guarded by `!shared`). The type is declared in `ClientEvent` (`src/lib/posthog/client.ts:98`). This step is genuinely instrumented. |
| — | `public_story_opened` | **MISSING** | `src/routes/s.$slug.tsx` and `src/components/public/PublicStoryReader.tsx` have no `capture()` call. This event matters for M.4 (viral loop) but also as a downstream signal past the M.1 funnel — once a story is shared, does anyone actually read it? |

Summary: **one of the five canonical funnel steps exists** (`story_shared`). Three are
missing outright (`signup`, `key_connected`, `story_written`). One is partial —
`timeline_created` fires on the UI path but silently drops on the MCP path.

### Taxonomy staleness vs. understand-app.md

`understand-app.md` (line 53) marks `story_written` as `(new, server)` and
`timeline_created` as `(new)`. The code has since shipped `timeline_created` on the
UI path (it is NOT new). The taxonomy is partially stale on steps 3 and 5.

---

## The pivotal metric — key-connection drop-off

`signup → key_connected` is the make-or-break step. A high drop-off (most signups
never connect a key) means:
- The BYO dev wedge is weaker than assumed; organic self-selection toward managed is
  happening silently.
- The CFO model's `activation %` assumption (currently a guess) is being filled with
  a favorable number.
- The copy and onboarding pointing to "connect Claude Code / Claude Desktop" may be
  failing a meaningful cohort who cannot or won't do that.

A low drop-off validates the BYO-first posture and tightens the p90 estimate for how
many managed-seat users there will be at a given signup rate.

No other single metric in M.1 carries this weight. Everything else in the funnel
(`timeline_created`, `story_written`, `story_shared`) is downstream of someone who
already has a working client. The key-connection step is where the audience splits.

---

## Who this is for

| Persona | What they came for | What M.1 tells us about them |
|---|---|---|
| **The Operator (founder)** | "Who is signing up, and what do they actually do?" | Activation % and key-connection drop-off → do the CFO model's assumptions hold? |
| **The Dev / BYO user** | Has a Claude Code or Claude Desktop client; comes for a structured memory layer. | If they connect a key quickly, the BYO wedge works. If they churn before step 3, onboarding is failing. |
| **The Creator / managed user** | Non-technical; wants to build timelines and stories without touching MCP config. | High step-2 drop-off here is expected and desirable — they convert to managed. What we need is evidence they get to step 4 (`story_written`) via in-app agent runs. |

---

## Scope posture (guardrail)

M.1 is **measurement, not billing**. It does not add a vendor, a pricing tier, a
gate, or a paywall. Specific out-of-scope calls:

- **M.6 Understand app (the dashboard that reads this data)** — stays in
  `understand-app.md`; M.1 ships the signals, M.6 builds the views.
- **M.5 usage ledger / COGS tracking** — METER. Already proposed separately.
- **M.2 retention cohorts** — a PostHog cohort configuration pass, not a code
  change; follows M.1 naturally once signups are tracked.
- **M.3 engagement depth** — `agent_run` is already emitted from
  `src/lib/server/agent.ts:117` (captureServer). `public_story_opened` is owed but
  is M.3/M.4 territory; M.1 only needs it as a downstream proof-of-concept. It is
  listed in the rollout as a small co-ship, not a hard dependency.
- **M.4 viral loop attribution** (`signup { source: 'shared_story' }`) — the
  `source` property on the `signup` event opens this door; the `slug` join is M.4
  config, not new code.
- **New analytics vendor** — no. The existing PostHog spine
  (`src/lib/posthog/client.ts` key: `VITE_POSTHOG_KEY`, `src/lib/posthog/server.ts`
  key: `POSTHOG_API_KEY`) is the only destination. Both are operator-gated (no key =
  nothing sent) and user opt-out-able (browser: `synek_analytics_opt_out` in
  localStorage). Local-first is untouched by construction.

---

## The shape

### Event list

All events use `distinct_id = userId` (Better Auth user id — already the convention;
unifies client and server events on one PostHog person per the existing `identifyUser`
call in `src/lib/posthog/client.ts:60`).

#### 1. `signup` — **new, server**

Emitted immediately after a successful user creation.

```
signup {
  source:   'email'               // only source for now; extensible for future SSO
  referrer: string | undefined    // window.document.referrer at signup time (M.4 seam)
}
```

**Where it goes:** `src/components/home/AuthForms.tsx`, inside the `submit` handler's
`mode === 'signup'` success branch (after the `if (res.error)` guard, line 50 area).
Use the browser `capture()` here — the auth is client-initiated. A parallel server-side
emit via a Better Auth `databaseHooks.after.createUser` callback in
`src/lib/auth/index.ts` is a cleaner long-term home (resilient to client-side JS
failure), but the client-side call is the minimal first slice.

#### 2. `key_connected` — **new, client**

Emitted when a user successfully saves a BYO OpenRouter key.

```
key_connected {
  provider:  'openrouter'         // only provider supported today; extensible
  segment:   'byo'                // always 'byo' when the user saves their own key
}
```

**Where it goes:** `src/components/account/AgentKeyCard.tsx`, inside `saveKey`
mutation's `onSuccess` handler (line 39), after `toast.success('OpenRouter key saved')`.
Use browser `capture()` — this is a client-initiated UI action.

Note: the `segment` property is forward-compatible with `managed_seat_started` (a
future no-key onboarding path for the managed SKU). For now only `'byo'` is emitted.

#### 3. `timeline_created` — **extend existing, add MCP path**

Already fires on the UI path (`src/components/home/NewTimelineDialog.tsx:67`).
**Gap:** the MCP `create_timeline` tool does not emit a distinct `timeline_created`
event — it emits only the generic `mcp_tool_called { tool: 'create_timeline' }`.

```
timeline_created {
  timeline_id: string
  source:      'ui' | 'mcp' | 'agent'
}
```

**What to change:**
- UI path (`NewTimelineDialog.tsx:67`): add `source: 'ui'` to the existing call —
  `capture('timeline_created', { timeline_id: row.id, source: 'ui' })`.
- MCP path: in `src/lib/mcp/server.ts` inside the `enrich()` function (or in the
  `register` wrapper), after the `tool === 'create_timeline'` result is confirmed ok,
  emit `captureServer(ownerId, 'timeline_created', { timeline_id: result.id, source: 'mcp' })`.
  The `result` object is the raw tool return from the registry handler; confirm the
  field name against `src/lib/mcp/registry.ts`'s `create_timeline` handler return shape.
- In-app agent path: the agent calls `create_timeline` through the same registry
  handler (`src/lib/agent/runner.ts` `executeToolCall`), but `captureServer` is not
  called per-tool there (only per-run in `agent.ts`). Emit `captureServer` inside
  the `executeToolCall` function for `create_timeline` specifically, or — cleaner —
  emit it from the registry handler itself (the handler is shared; tag `source` from
  a `ctx` field). Decision: keep analytics out of the registry handlers (they are
  transport-agnostic); emit from the `executeToolCall` path in `runner.ts` for
  `tool.name === 'create_timeline'`, tagging `source: 'agent'`. One small block, no
  architectural debt.

#### 4. `story_written` — **new, server**

Emitted when a story is created or updated via `write_story`. The existing
`mcp_tool_called { tool: 'write_story' }` event carries engagement properties
(segments, cast, artifact citations) but cannot serve as a funnel step — it has no
distinct event name, and it only covers the MCP/agent path.

```
story_written {
  timeline_id: string
  story_id:    string
  beats:       number    // segment count
  is_update:   boolean   // false = first write to this story_id
  source:      'mcp' | 'agent' | 'ui'
}
```

**Where it goes:**

- MCP path: emit from `src/lib/mcp/server.ts` register wrapper after the
  `write_story` result, using `captureServer`. The result already contains
  `story_id`; `args.timelineId` / `args.segments.length` are available in the
  wrapper. Augment `enrich()` to add the `story_written` captureServer call, or add
  a dedicated post-call block for `write_story` beside the `mcp_tool_called` emit.
  `is_update` = `!!args.storyId` (if the caller passed a storyId, it's an update).
- Agent path: emit from `executeToolCall` in `runner.ts` for
  `tool.name === 'write_story'`, server-side via `captureServer`. Same properties.
- UI / NewStoryDialog path: `src/components/canvas/NewStoryDialog.tsx` does not
  appear to write a story directly (it copies a prompt or runs the agent); confirm
  that no direct `write_story` call exists in the UI path. If a direct UI call exists,
  add `capture('story_written', …)` at the success point. If not, agent/MCP paths cover it.

#### 5. `story_shared` — **EXISTS**

`src/components/public/ShareStoryButton.tsx:39`:
```ts
if (!shared) capture('story_shared', { story_id: storyId })
```

This fires on first-share only (`!shared` guard). It is declared in `ClientEvent`
(`src/lib/posthog/client.ts:98`). No changes needed.

Minor gap to flag: the event carries `story_id` but not `timeline_id`. Consider adding
`timeline_id` for cross-event joining, but this is not blocking.

---

#### Co-ship: `public_story_opened` — **new, client**

Not a funnel step for M.1 but a required downstream signal (M.3/M.4) and trivially
co-shipped here. Emit from `src/components/public/PublicStoryReader.tsx` on mount:

```
public_story_opened {
  story_id:   string
  slug:       string
  referrer:   string | undefined   // document.referrer — attribution seam for M.4
}
```

The component already receives `data` (a `PublicStoryDTO`); the story id and slug are
available. A single `useEffect` on mount is the correct place. Since the public page
is SSR'd, this must be client-only (inside the effect, not during render).

---

### PostHog funnel configuration (not code)

Once the events fire, the M.1 funnel is PostHog configuration — no additional code:

**Funnel: Activation** (ordered, 30-day completion window)
1. `signup`
2. `key_connected`
3. `timeline_created`
4. `story_written`
5. `story_shared`

**Key-connection drop-off insight:** configure a PostHog **Funnel Breakdown** on
step 2 (`key_connected`) with drop-off users segmented by `signup.source` (email vs.
eventual SSO) and any device/referrer properties captured at signup. This surfaces
not just the aggregate drop-off % but whether it skews toward a cohort.

**Retention cohort seed (M.2 bootstrap):** once signups are tracked, create a PostHog
cohort "Activated users" = completed steps 1–3 within 7 days. This becomes the
denominator for D7/D30 retention (M.2). M.1's `signup` event is M.2's starting gun.

---

## Success metrics

After 2–4 weeks of cloud traffic, M.1 lets us answer:

| Question | Metric | Financial model cell |
|---|---|---|
| What fraction of signups reach step 2? | `key_connected / signup` — the key-connection drop-off % | CFO `activation_rate` assumption |
| How many connected-key users build a timeline? | `timeline_created / key_connected` | `activation_to_engagement` conversion |
| How many builders write a story? | `story_written / timeline_created` | Story-layer adoption (bet B3 health) |
| How many story writers share publicly? | `story_shared / story_written` | Viral loop supply rate (M.4 input) |
| Full funnel activation rate | `story_shared / signup` end-to-end | CFO model's headline "engaged user %" |
| Time-to-first-timeline | Median hours from `signup` → `timeline_created` | Onboarding speed; informs copy and default state |
| BYO vs. managed path split (future) | Ratio of `key_connected { segment: 'byo' }` to `managed_seat_started` | Seat mix assumption in revenue model |

The `understand-app.md` "Tie to the financial model" section lists these same cells.
M.1 is what fills them with measured numbers instead of guesses.

---

## Rollout (smallest shippable increments)

Each step is independently typecheck-green and independently verifiable.

### Increment 1 — `signup` emit (client)
Add `capture('signup', { source: 'email', referrer: document.referrer || undefined })`
to `src/components/home/AuthForms.tsx` in the signup success branch (after the
`toast.success` on line 50). Add `'signup'` to the `ClientEvent` union in
`src/lib/posthog/client.ts`. Typecheck green; no behavior change.

### Increment 2 — `key_connected` emit (client)
Add `capture('key_connected', { provider: 'openrouter', segment: 'byo' })` to
`src/components/account/AgentKeyCard.tsx` in `saveKey.onSuccess` after the toast
(line 40). Add `'key_connected'` to `ClientEvent`. Typecheck green.

### Increment 3 — `timeline_created` MCP + agent paths
- Add `source: 'ui'` to the existing call in `NewTimelineDialog.tsx:67`.
- Emit `captureServer(ownerId, 'timeline_created', { timeline_id, source: 'mcp' })`
  from the `register` wrapper in `server.ts` for `name === 'create_timeline'` on
  success (after `mcp_tool_called` emit).
- Emit `captureServer(ctx.ownerId, 'timeline_created', { timeline_id, source: 'agent' })`
  from `executeToolCall` in `runner.ts` for `tool.name === 'create_timeline'` on
  success (the result JSON contains the id; parse it).
- Update `ClientEvent` type comment to note `source` property.
Typecheck green; the `register` wrapper already has the result object.

### Increment 4 — `story_written` emit (server)
- In `server.ts`, after the `mcp_tool_called` captureServer for `write_story`
  (inside the `register` wrapper success branch), add a second
  `captureServer(ownerId, 'story_written', { timeline_id: args.timelineId, story_id: result.storyId, beats: args.segments?.length ?? 0, is_update: !!args.storyId, source: 'mcp' })`.
  Confirm `result.storyId` field name against the `write_story` handler's return value
  in `registry.ts` before shipping.
- In `runner.ts` `executeToolCall`, add an analogous block for
  `tool.name === 'write_story'` (parse the result JSON for `storyId`).
Typecheck green.

### Increment 5 — `public_story_opened` co-ship (client)
Add to `src/components/public/PublicStoryReader.tsx`:
```tsx
useEffect(() => {
  capture('public_story_opened', {
    story_id: data.story.id,
    slug: data.slug,
    referrer: document.referrer || undefined,
  })
}, [])
```
Add `'public_story_opened'` to `ClientEvent`. Typecheck green. (This event is already
declared in the type — check `client.ts:99` — but the emit is missing at the call
site. If already declared, no type change needed.)

### Increment 6 — PostHog funnel + drop-off configuration
Pure PostHog UI config: create the 5-step activation funnel, set the 30-day window,
add the key-connection breakdown. No code. Verifiable by creating a test account and
walking the 5 steps — all events should appear in PostHog's Live Events view.

### Verification (instead of a `verify:*` data-layer script)

M.1 is mostly PostHog events, not a DB table, so a data-layer script would be testing
the PostHog SDK — not our logic. The correct verification is a **manual smoke-walk**:

1. Start the app with `VITE_POSTHOG_KEY` and `POSTHOG_API_KEY` set, pointing at a test
   PostHog project (or the live one with a `[test]` distinct_id prefix).
2. Open PostHog **Live Events** in a side panel.
3. Sign up → confirm `signup` event appears.
4. Save an OpenRouter key → confirm `key_connected`.
5. Create a timeline via the UI dialog → confirm `timeline_created { source: 'ui' }`.
6. Connect an MCP client and call `create_timeline` → confirm `timeline_created { source: 'mcp' }`.
7. Call `write_story` → confirm `story_written`.
8. Share a story → confirm `story_shared`.
9. Open the `/s/$slug` link in an incognito window → confirm `public_story_opened`.

This walk takes under 10 minutes and is the gate before the funnel config step.

---

## Risks / open decisions (for the founder)

1. **Server-side vs. client-side `signup`.** A client-side `capture` in `AuthForms.tsx`
   is the minimal change. It is lost if the user closes the tab immediately after signup
   or if the browser blocks the PostHog request. A server-side emit via Better Auth
   `databaseHooks` is more reliable but requires reading the Better Auth docs for the
   right hook shape (the auth module at `src/lib/auth/index.ts` has no hooks today).
   Recommendation: **ship client-side first** (one line), evaluate loss rate from
   PostHog's `signup` vs. email-verification counts, then add server-side if the gap is
   meaningful. Low urgency — the funnel only needs relative rates, not absolute counts.

2. **`story_written` field name confidence.** Increment 4 requires reading
   `result.storyId` from the `write_story` handler's return value. Confirm the exact
   field name in `src/lib/mcp/registry.ts`'s `write_story` handler before shipping —
   the emit silently no-ops if the field is named differently (e.g. `id` instead of
   `storyId`). **High confidence this is verifiable in 30 seconds; flag it, don't
   block on it.**

3. **`key_connected` for MCP-only users.** A dev who authenticates via MCP bearer
   token (`bun run issue:key`) and never opens the settings UI will not emit
   `key_connected`. This cohort is the purest BYO user. They will appear in the funnel
   as `signup → [gap] → timeline_created`, which will make the key-connection drop-off
   look worse than it is. Consider whether a `bun run issue:key` flow should emit a
   server-side `key_connected { provider: 'mcp_bearer', segment: 'byo' }`. Low
   priority for the first measurement window; important before reading the data as
   final truth.

4. **Measurement window before action.** Run free for 2–4 weeks before interpreting
   the funnel. The first users are likely developers and early adopters — not a
   representative sample of the creator audience. The key-connection rate will probably
   look high. That is expected; what matters is the trend as the user mix broadens.
