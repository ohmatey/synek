import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from './index'
import { usageLedger } from './schema'

// METER data layer — append-only writes + the windowed read the safety cap uses.
// Trusts a guarded caller (ownerId comes from the authenticated session). Writes are
// best-effort at the CALL SITES (wrapped in try/catch there so metering can never
// fail the user's work); this module just runs the SQL.

type Funded = 'operator' | 'byo'

// One completed agent run → a PAIR of rows: a count row (agent_run, qty 1) and a
// token row (agent_tokens, qty = total). Splitting them keeps the cap's SUM queries
// trivial (no JSON parsing). Cost sits on the run row only, never double-counted.
export function appendAgentRun(input: {
  ownerId: string
  model: string
  funded: Funded
  totalTokens: number
  promptTokens: number
  completionTokens: number
  costUsd?: number
  steps: number
  toolCalls: number
  ok: boolean
  timelineId?: string
}): void {
  const ts = new Date()
  const yourCostCents = input.costUsd != null ? Math.round(input.costUsd * 100) : null
  const meta = {
    steps: input.steps,
    toolCalls: input.toolCalls,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    ok: input.ok,
    ...(input.timelineId ? { timelineId: input.timelineId } : {}),
  }
  db.insert(usageLedger)
    .values([
      {
        ownerId: input.ownerId,
        ts,
        source: 'agent',
        metric: 'agent_run',
        quantity: 1,
        model: input.model,
        funded: input.funded,
        yourCostCents,
        meta,
      },
      {
        ownerId: input.ownerId,
        ts,
        source: 'agent',
        metric: 'agent_tokens',
        quantity: input.totalTokens,
        model: input.model,
        funded: input.funded,
        yourCostCents: null,
        meta,
      },
    ])
    .run()
}

// One MCP tool call (any tool, any transport) → one row, funded 'byo' (the power
// user's own client/model does the thinking — no operator inference cost), cost 0.
// Volume/intel only; throttling MCP is deferred.
export function appendMcpToolCall(input: { ownerId: string; tool: string; ok: boolean }): void {
  db.insert(usageLedger)
    .values({
      ownerId: input.ownerId,
      ts: new Date(),
      source: 'mcp',
      metric: 'mcp_tool_call',
      quantity: 1,
      model: null,
      funded: 'byo',
      yourCostCents: 0,
      meta: { tool: input.tool, ok: input.ok },
    })
    .run()
}

// Rolling-window usage for the OPERATOR-funded path only — the safety cap reads this.
// BYO rows are excluded (their spend, not our COGS). One round-trip, two conditional
// sums. `sinceMs` is an epoch-ms lower bound (exclusive).
export function operatorUsageInWindow(ownerId: string, sinceMs: number): { runs: number; tokens: number } {
  const since = new Date(sinceMs)
  const row = db
    .select({
      runs: sql<number>`coalesce(sum(case when ${usageLedger.metric} = 'agent_run' then ${usageLedger.quantity} else 0 end), 0)`,
      tokens: sql<number>`coalesce(sum(case when ${usageLedger.metric} = 'agent_tokens' then ${usageLedger.quantity} else 0 end), 0)`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.ownerId, ownerId), eq(usageLedger.funded, 'operator'), gt(usageLedger.ts, since)))
    .get()
  return { runs: Number(row?.runs ?? 0), tokens: Number(row?.tokens ?? 0) }
}
