---
phase: METER
title: "Usage ledger + safety rate limit (the measurement floor)"
status: built*
era: "Monetization groundwork (measure-first)"
updated: 2026-06-19
---

> **\* Built (data layer), 2026-06-19.** `usage_ledger` table (migration 0027) + the agent/MCP writers + the operator-funded rolling-24h safety cap are shipped and verified at the data layer (`bun run verify:usage`, 19 checks; typecheck + `verify:isolation` + `verify:mcp` green). Founder decisions baked in: real COGS via OpenRouter `usage:{include:true}`; ceiling ON at cloud launch via the deploy configmap (`SYNEK_AGENT_DAILY_RUNS=40`, `SYNEK_AGENT_DAILY_TOKENS=2000000` — on sector137, `kubernetes/overlays/synek/configmap.yaml`), inert in BYO-only mode. **Owed:** a live in-browser pass (needs a real `OPENROUTER_API_KEY` — the dev preview can't hydrate the agent) confirming a row pair + non-null cost land and the cap trips. Phase 3 (admin dashboard + pricing) builds on this.

# METER — Usage ledger + safety rate limit

> **The promise.** Before we price anything, we *measure* it. Every operator-funded AI run writes one honest row to an append-only ledger, and that same ledger is the source the safety cap reads from. We come out the other side able to answer "what does a seat actually cost, and where should the fair-use line sit?" — with data, not a guess. And the cloud can't run away with our OpenRouter bill while we find out.

## Why this, why now

The dual-audience cloud is [already covered at the plumbing level](../../../CLAUDE.md): normal users log in and use the built-in agent (operator-funded via `OPENROUTER_API_KEY`, falling back from a per-user BYO key — `src/lib/server/agent.ts` `resolveKey`); power users point a BYO MCP client at `/api/mcp`. The architecture works. **Two things don't:**

1. **No measurement.** `runAgentLoop` tracks `tokensUsed` internally (`src/lib/agent/runner.ts:135`, summing `usage.total_tokens`) but **`AgentRunResult` drops it** — it returns `steps`/`toolCalls`, never the tokens. We emit an `agent_run` PostHog event with no token quantity. So today we **cannot** answer the only questions that matter for pricing: tokens per run, runs per user per day, COGS per user, what fraction of users would blow past cap *X*.

2. **No across-run cap.** The agent is bounded *per run* (`agentBudgets()`: 12 steps, 120k tokens, 60s — `src/lib/agent/config.ts:43`). A logged-in normal user on the operator's key can fire **unlimited runs**. On the operator-funded path that is uncapped COGS on our wallet. This is the enforcement half of the locked **seat + fair-use-cap** model (`docs/finance` model; monetization decision: money on *seats*, not tokens) — the model is decided, the *cap* is unbuilt.

This is the **minimum first slice** of the broader `usage_ledger` already designed in [understand-app.md](understand-app.md) (M.5 — your-side COGS). That PRD owns the admin dashboard and the full metric set; **this** PRD ships only the table, the agent writer, and the safety cap. One elegant consequence: **the append-only ledger doubles as the quota source** — the rate limit is a `SELECT … WHERE ts > now - window` over the rows we're writing anyway. One table, both jobs.

## Who this is for

| Persona | What they came for | What they get today | What METER gives them |
|---|---|---|---|
| **The Operator (you)** — primary | "Let normal users use AI without my OpenRouter bill running away, and learn what a seat costs." | A global key and a prayer; zero per-user visibility. | A per-run COGS ledger + an env-set daily cap that fails closed. |
| **The Normal user** | "Log in, ask the agent to build my timeline." | Unlimited runs (until the operator notices the bill). | Same experience under the cap; a clear "limit reached, resets in Nh — or add your own key for no cap" message that doubles as a BYO upsell. |
| **The Power / BYO user** | "Use my own OpenRouter key (in-app or via MCP)." | Works; uncounted. | Exempt from the COGS cap (it's *their* spend); still ledgered for product intel. |

## Scope posture (guardrail)

CLAUDE.md defers **billing/metering to Phase 3**. METER is explicitly **not billing** — it is the *measurement floor + a safety valve* that Phase 3 will price against. It stays in scope because:

- It is **measure-first**, the locked monetization posture (`usage_ledger` "repurposed for product-intel + COGS").
- The cap is a **cost-safety guard**, not a paid tier or a metered charge. No Stripe, no invoices, no plans.
- **Local-first is untouched.** Limits are env-gated and **default to unlimited/off** — a self-host download behaves exactly as today; only a configured cloud operator turns caps on.

**Explicitly out of scope (deferred):**
- The admin dashboard / "Understand app" that reads the ledger → stays in [understand-app.md](understand-app.md).
- Stripe, plans, paid quotas, overage, invoices → Phase 3.
- Per-key scopes, team/org quotas, audit logs.
- A live in-canvas "you've used X of Y" meter UI (the cap message at the point of refusal is enough for v1).
- Hard MCP rate limiting (see §"MCP surface" — v1 only *ledgers* MCP volume; throttling it is a follow-up).

## The shape

### 1. The table (`usage_ledger`)

Append-only, owner-scoped, Postgres-portable (matches `schema.ts` conventions: `text` id via `crypto.randomUUID()`, `integer` `timestamp_ms`, `text({mode:'json'})`). A **strict subset** of understand-app's design so the two converge, not fork.

```
usage_ledger {
  id              TEXT PRIMARY KEY        -- crypto.randomUUID()
  ownerId         TEXT NOT NULL → user.id (cascade)   -- the security + segmentation boundary
  ts              INTEGER NOT NULL        -- timestamp_ms
  source          TEXT NOT NULL           -- 'agent' | 'mcp'   (who incurred it)
  metric          TEXT NOT NULL           -- 'agent_run' | 'agent_tokens' | 'mcp_tool_call'
  quantity        INTEGER NOT NULL        -- tokens, or 1 per run / per call
  model           TEXT                    -- OpenRouter model slug (agent rows)
  funded          TEXT NOT NULL           -- 'operator' | 'byo'  (whose key paid)
  yourCostCents   INTEGER                 -- our COGS in cents; null until known/derived
  meta            TEXT (json)             -- { steps, toolCalls, promptTokens, completionTokens, ok, tool? }
}
```

Index `(ownerId, ts)` — the quota query's access path. Append-only: **no updates, no deletes** (except user-cascade). Dedupe is structural — one row per completed run / per tool call; no event-id needed at this volume.

Write **two rows per agent run** so tokens and run-count are independently summable without parsing: an `agent_run` row (`quantity: 1`) and an `agent_tokens` row (`quantity: totalTokens`). Cheap; keeps the quota queries trivial.

### 2. Surface the tokens the runner already counts

`AgentRunResult` gains `promptTokens`, `completionTokens`, `totalTokens`. The runner currently sums only `total_tokens`; also read `usage.prompt_tokens` / `usage.completion_tokens` per step (OpenRouter returns them) and accumulate. **One-line-ish change at the source of truth** (`runner.ts`), unlocking everything downstream.

**Get real COGS, not an estimate.** OpenRouter can return the actual credit cost per request when the call sets `usage: { include: true }` in the request body — capture that into `yourCostCents` so the margin number is *real*, not a price-table guess. (Confidence: moderate — verify the exact field on the OpenRouter response before relying on it; if absent, fall back to a model→price map applied offline, which is why `yourCostCents` is nullable.)

### 3. Write the ledger — one append in `runAgent`

In `src/lib/server/agent.ts`, after `runAgentLoop` returns, append the two rows (alongside the existing `captureServer('agent_run', …)`, which stays for funnel analytics). `funded` = `'byo'` when `resolveKey` used the user's stored key, else `'operator'` — `resolveKey` already knows which; thread that boolean out. Failure to write the ledger must **never** fail the run (wrap in try/catch, log) — measurement is best-effort, the user's work is not.

### 4. The safety cap — pre-flight in `runAgent`, reading the ledger

Before calling `runAgentLoop`, **only on the `operator`-funded path**, check the rolling 24h window from the ledger:

```
operatorTokensToday = Σ quantity where ownerId=? and metric='agent_tokens'
                        and funded='operator' and ts > now-24h
operatorRunsToday   = count where ownerId=? and metric='agent_run'
                        and funded='operator' and ts > now-24h
```

Env-configured, **unset = unlimited** (preserves local-first / self-host):

| Env | Meaning | Default |
|---|---|---|
| `SYNEK_AGENT_DAILY_RUNS` | max operator-funded runs / user / 24h | unset → ∞ |
| `SYNEK_AGENT_DAILY_TOKENS` | max operator-funded tokens / user / 24h | unset → ∞ |

**BYO-key users are exempt** (it's their spend) — the cap is about *our* COGS. Over the line → fail closed with the same friendly shape the runner already uses, and turn the wall into a funnel:

> "You've reached today's AI limit (N runs). It resets in ~Xh — or add your own OpenRouter key under **API keys** for no cap." (`src/lib/agent/runner.ts` already returns `{ ok:false, error }`; reuse it.)

Rolling-window-from-the-ledger (not a separate counter table, not a fixed calendar reset) keeps it **one source of truth** and naturally self-expiring. A coarse per-minute abuse guard (e.g. ≤1 concurrent / ≤N per minute, BYO included) is a cheap add but **optional** for v1.

### 5. MCP surface (light)

Power users on a BYO client cost us **no inference** (their model does the thinking) — only DB/storage when their tools write. So v1 **ledgers MCP volume for product intel** by appending a `mcp_tool_call` row from the existing `register` analytics wrapper in `src/lib/mcp/server.ts` (it already fires `mcp_tool_called` to PostHog on both transports — piggyback one ledger append, `funded:'byo'`, `yourCostCents:0`). **Throttling MCP is deferred** — no operator inference cost to defend yet; revisit if storage/abuse shows up in the data.

## Success metrics — what we can answer after ~2–4 weeks of cloud traffic

The whole point. METER is done when the ledger lets us compute:

- **Per-run distribution:** median / p90 / p99 `totalTokens` and tool calls per run → calibrates the *per-run* budgets too.
- **Per-user intensity:** operator-funded runs and tokens per active user per day → the **fair-use cap candidate** (e.g. "cap at p90 of normal users").
- **COGS per user / per seat** (¢) → feeds the seat price and the managed-tier margin in the finance model.
- **BYO vs operator split** → how much demand is already self-funding.
- **Cap-impact simulation:** "at `DAILY_TOKENS = K`, X% of users hit the wall on a given day" → set K with eyes open before it's ever a paid limit.

## Rollout (smallest shippable increments)

1. **Surface tokens** — `AgentRunResult` gains `promptTokens/completionTokens/totalTokens`; runner accumulates the breakdown + (if available) `usage.cost`. Typecheck green; no behavior change.
2. **Table + migration** — `usage_ledger` in `schema.ts`; `bun run db:generate`. Owner-cascade, `(ownerId, ts)` index.
3. **Writer** — append the two agent rows in `runAgent`; thread `funded` out of `resolveKey`; best-effort try/catch.
4. **Cap** — env-gated pre-flight quota check; unset = ∞; BYO exempt; friendly+upsell refusal.
5. **MCP ledger row** — piggyback the `register` wrapper.
6. **`verify:usage`** — a Node data-layer script (the project's pattern, e.g. `verify:mcp`): seed a fake user, write runs, assert the quota query sums correctly, assert unset-env = unlimited and a set cap fails closed. No live OpenRouter needed.

Steps 1–4 are the cost-safety core; 5–6 round it out. Each is independently green-able.

## Risks / open decisions (for the founder)

1. **Cap default on cloud.** Ship with caps **unset** (measure pure demand first, eat a bounded bill for a few weeks) or set a generous ceiling from day one? Recommendation: **unset for the first measurement window**, then set from real p90 — you can't calibrate a cap you've never observed traffic without. *Decide before cloud launch.*
2. **Window semantics.** Rolling 24h (chosen — self-expiring, one source) vs. calendar-day reset (simpler mental model for users, needs "resets at midnight UTC" copy). Rolling is better engineering; calendar is friendlier UX. Lean rolling.
3. **Ledger write volume.** Two rows/run + one/MCP-call on single-instance SQLite is trivial at expected scale, but it is *write* traffic on the single writer. Fine now; a reason (among others) the deferred Postgres port eventually matters.
4. **Real COGS dependency.** If OpenRouter doesn't return per-request cost cleanly, `yourCostCents` stays null and COGS is derived offline from a price map — acceptable, but flag it so the margin number isn't mistaken for measured when it's modeled.
