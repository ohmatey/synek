import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user, usageLedger } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'
import { appendAgentRun, appendMcpToolCall, hasPriorMcpUsage, operatorUsageInWindow } from '../src/lib/db/usage-ledger'
import { agentQuota, type AgentQuota } from '../src/lib/agent/config'

// Proves the METER data path: the append-only usage_ledger records each agent run as
// a (agent_run + agent_tokens) pair, the windowed read sums ONLY operator-funded rows
// inside the window (BYO + out-of-window + MCP excluded), and the safety-cap decision
// trips on a set cap but never on an unset one. Runs against the real DB layer — no
// model, no HTTP. Run under Node: `bun run verify:usage`.

// Unique owners per run so exact-count asserts hold against the persisted verify db.
const STAMP = Date.now()
const A_EMAIL = `meter-a-${STAMP}@synek.app`
const B_EMAIL = `meter-b-${STAMP}@synek.app`
const DAY_MS = 24 * 60 * 60 * 1000

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function ensureUser(email: string): Promise<string> {
  try {
    await auth.api.signUpEmail({ body: { email, password: 'meter-pw-123', name: email } })
  } catch {
    /* already exists */
  }
  const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
  if (!row) throw new Error(`could not create user ${email}`)
  return row.id
}

const rowsFor = (ownerId: string) => db.select().from(usageLedger).where(eq(usageLedger.ownerId, ownerId)).all()

// Mirrors the cap decision in src/lib/server/agent.ts runAgent (operator-funded only).
function capTrips(cap: AgentQuota, used: { runs: number; tokens: number }): boolean {
  return (cap.dailyRuns != null && used.runs >= cap.dailyRuns) || (cap.dailyTokens != null && used.tokens >= cap.dailyTokens)
}

async function main() {
  const a = await ensureUser(A_EMAIL)
  const b = await ensureUser(B_EMAIL)
  assert(a !== b, 'two distinct users exist')
  assert(rowsFor(a).length === 0, 'owner A starts with an empty ledger')

  // 1. One operator-funded agent run → exactly two rows (run + tokens), cost on run.
  appendAgentRun({
    ownerId: a,
    model: 'anthropic/claude-sonnet-4.6',
    funded: 'operator',
    totalTokens: 5000,
    promptTokens: 3000,
    completionTokens: 2000,
    costUsd: 0.012,
    steps: 3,
    toolCalls: 2,
    ok: true,
    timelineId: 'tl-1',
  })
  const after1 = rowsFor(a)
  assert(after1.length === 2, 'appendAgentRun writes exactly two rows')
  const runRow = after1.find((r) => r.metric === 'agent_run')!
  const tokRow = after1.find((r) => r.metric === 'agent_tokens')!
  assert(runRow.quantity === 1 && tokRow.quantity === 5000, 'run row qty=1, tokens row qty=5000')
  assert(runRow.yourCostCents === 1 && tokRow.yourCostCents === null, 'cost (1¢) on the run row only, not double-counted')
  assert(runRow.funded === 'operator', 'run is tagged funded=operator')

  // 2. The windowed read sums the operator run.
  let used = operatorUsageInWindow(a, Date.now() - DAY_MS)
  assert(used.runs === 1 && used.tokens === 5000, 'operatorUsageInWindow sees runs=1, tokens=5000')

  // 3. A BYO run is ledgered but EXCLUDED from the operator window (their spend).
  appendAgentRun({
    ownerId: a,
    model: 'anthropic/claude-sonnet-4.6',
    funded: 'byo',
    totalTokens: 9000,
    promptTokens: 6000,
    completionTokens: 3000,
    steps: 4,
    toolCalls: 1,
    ok: true,
  })
  used = operatorUsageInWindow(a, Date.now() - DAY_MS)
  assert(used.runs === 1 && used.tokens === 5000, 'BYO run excluded from operator window')

  // 4. An MCP tool call is ledgered (byo) but never counts toward operator agent sums.
  appendMcpToolCall({ ownerId: a, tool: 'apply_patch', ok: true })
  used = operatorUsageInWindow(a, Date.now() - DAY_MS)
  assert(used.runs === 1 && used.tokens === 5000, 'MCP call excluded from operator window')
  assert(rowsFor(a).some((r) => r.source === 'mcp' && r.metric === 'mcp_tool_call'), 'mcp_tool_call row was written')

  // 5. Out-of-window operator rows are excluded by the window, included when the
  //    lower bound is 0. Insert a 3-day-old operator pair directly.
  const old = new Date(Date.now() - 3 * DAY_MS)
  db.insert(usageLedger)
    .values([
      { ownerId: a, ts: old, source: 'agent', metric: 'agent_run', quantity: 1, model: 'x', funded: 'operator', yourCostCents: null, meta: {} },
      { ownerId: a, ts: old, source: 'agent', metric: 'agent_tokens', quantity: 7000, model: 'x', funded: 'operator', yourCostCents: null, meta: {} },
    ])
    .run()
  used = operatorUsageInWindow(a, Date.now() - DAY_MS)
  assert(used.runs === 1 && used.tokens === 5000, '3-day-old operator rows excluded from a 24h window')
  const allTime = operatorUsageInWindow(a, 0)
  assert(allTime.runs === 2 && allTime.tokens === 12000, 'same rows included when window lower-bound is 0')

  // 6. Owner isolation — B's window is empty regardless of A's rows.
  const bUsed = operatorUsageInWindow(b, 0)
  assert(bUsed.runs === 0 && bUsed.tokens === 0, "owner B's window is empty (rows are owner-scoped)")

  // 7. The cap decision: a set cap trips when usage meets it; an unset cap never does.
  const usedNow = operatorUsageInWindow(a, Date.now() - DAY_MS)
  delete process.env.SYNEK_AGENT_DAILY_RUNS
  delete process.env.SYNEK_AGENT_DAILY_TOKENS
  assert(!capTrips(agentQuota(), usedNow), 'unset caps (∞) never trip — local-first preserved')

  process.env.SYNEK_AGENT_DAILY_RUNS = '1'
  assert(agentQuota().dailyRuns === 1, 'agentQuota() reads SYNEK_AGENT_DAILY_RUNS from env')
  assert(capTrips(agentQuota(), usedNow), 'a runs cap of 1 trips at runs=1')

  delete process.env.SYNEK_AGENT_DAILY_RUNS
  process.env.SYNEK_AGENT_DAILY_TOKENS = '1000000'
  assert(!capTrips(agentQuota(), usedNow), 'a generous token cap (1M) does not trip at 5000 tokens')
  process.env.SYNEK_AGENT_DAILY_TOKENS = '4000'
  assert(capTrips(agentQuota(), usedNow), 'a token cap below usage (4000 < 5000) trips')
  process.env.SYNEK_AGENT_DAILY_TOKENS = '0'
  assert(agentQuota().dailyTokens === null, '0 means unlimited (treated as unset)')

  // 8. M.1 funnel: the MCP-connect watermark. The first authenticated MCP call has
  //    no prior usage (→ the wrapper would EMIT key_connected{mcp_bearer}); after a
  //    call lands, the watermark is true (→ the wrapper SKIPS, so it fires once). The
  //    probe is owner-scoped, so the BYO-MCP cohort can't leak across users.
  const c = await ensureUser(`meter-c-${STAMP}@synek.app`)
  assert(hasPriorMcpUsage(c) === false, 'fresh owner C: no prior MCP usage → first call would emit key_connected')
  appendMcpToolCall({ ownerId: c, tool: 'list_timelines', ok: true })
  assert(hasPriorMcpUsage(c) === true, 'after one MCP call: watermark true → subsequent calls skip the emit (fires once)')
  assert(hasPriorMcpUsage(a) === true, "owner A (has an mcp_tool_call from step 4) reads true")
  assert(hasPriorMcpUsage(b) === false, 'owner B (never called MCP) reads false — watermark is owner-scoped')

  console.log('\nMETER usage-ledger + safety-cap data path verified ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
