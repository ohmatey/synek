import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getTimelineMeta } from '~/lib/db/graph'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import { getUserSettingsRow } from '~/lib/db/user-settings'
import { decryptSecret } from '~/lib/crypto/secrets'
import { makeRequireOwnedProject } from '~/lib/db/projects'
import { makeRequireOwned, type ToolCtx } from '~/lib/mcp/registry'
import { openRouterKey, defaultModel, agentQuota } from '~/lib/agent/config'
import { runAgentLoop, type AgentRunResult } from '~/lib/agent/runner'
import { appendAgentRun, operatorUsageInWindow } from '~/lib/db/usage-ledger'
import { captureServer } from '~/lib/posthog/server'

// The in-app agent's two server entry points. getAgentConfig tells the client
// whether to offer "Run"; runAgent executes a prompt server-side against the SAME
// tools the MCP server exposes, committing real Patches that stream to the open
// canvas via the existing SSE path.
//
// Phase 2: the OpenRouter key is resolved PER USER — the user's own stored key
// (decrypted) first, then the operator env key as a self-host fallback. The key
// never crosses to the client (getAgentConfig returns only flags).

// The resolved key AND who pays for it — 'byo' (the user's own stored key) or
// 'operator' (the env key the host funds). `funded` drives both the safety cap (only
// operator-funded runs are capped) and the ledger tag.
type ResolvedKey = { key: string; funded: 'operator' | 'byo' }

function resolveKey(userId: string): ResolvedKey | null {
  const row = getUserSettingsRow(userId)
  if (row?.openRouterKeyEnc) {
    try {
      return { key: decryptSecret(row.openRouterKeyEnc), funded: 'byo' }
    } catch {
      /* corrupt blob or rotated SYNEK_SECRETS_KEY — fall through to the env key */
    }
  }
  const env = openRouterKey()
  return env ? { key: env, funded: 'operator' } : null
}

const DAY_MS = 24 * 60 * 60 * 1000

function resolveModel(userId: string): string {
  return getUserSettingsRow(userId)?.agentModel?.trim() || defaultModel()
}

const FAIL = (error: string): AgentRunResult => ({ ok: false, summary: '', patchIds: [], steps: 0, toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, error })

// Per-user: enabled when the user has a stored key OR the operator env key is set.
// Anonymous (a public-timeline viewer) → disabled. NEVER returns the key.
export const getAgentConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await getCurrentUser()
  if (!user) return { enabled: false, defaultModel: defaultModel() }
  return { enabled: !!resolveKey(user.id), defaultModel: resolveModel(user.id) }
})

const runInput = z.object({
  timelineId: z.string(),
  prompt: z.string().min(1),
  model: z.string().optional(),
})

export const runAgent = createServerFn({ method: 'POST' })
  .inputValidator((d: z.infer<typeof runInput>) => runInput.parse(d))
  .handler(async ({ data }): Promise<AgentRunResult> => {
    const user = await requireUser()
    const resolved = resolveKey(user.id)
    if (!resolved) return FAIL('No OpenRouter key configured — add yours under API keys to run.')
    const meta = getTimelineMeta(data.timelineId)
    if (!meta || meta.ownerId !== user.id) return FAIL('forbidden: not your timeline')

    // Safety cap (METER): only the operator-funded path is capped — BYO-key users
    // spend their own credits, so they're exempt. Caps default to unlimited (env
    // unset), so local/self-host never trips this; a cloud deploy sets them.
    if (resolved.funded === 'operator') {
      const cap = agentQuota()
      if (cap.dailyRuns != null || cap.dailyTokens != null) {
        const used = operatorUsageInWindow(user.id, Date.now() - DAY_MS)
        if ((cap.dailyRuns != null && used.runs >= cap.dailyRuns) || (cap.dailyTokens != null && used.tokens >= cap.dailyTokens)) {
          return FAIL("You've reached today's AI limit. It resets within 24h — or add your own OpenRouter key under API keys for no cap.")
        }
      }
    }

    // The run is anchored to one timeline, so its project is the session's active
    // project: any create_timeline the agent makes during the run lands alongside it.
    const ctx: ToolCtx = {
      ownerId: user.id,
      projectId: meta.projectId ?? undefined,
      requireOwned: makeRequireOwned(user.id),
      requireOwnedProject: makeRequireOwnedProject(user.id),
    }
    const model = data.model?.trim() || resolveModel(user.id)
    const t0 = performance.now()
    const result = await runAgentLoop({ prompt: data.prompt, model, apiKey: resolved.key, ctx })

    // Ledger the run (METER) — best-effort: a metering failure must never fail the
    // user's work. Writes the agent_run + agent_tokens pair tagged with `funded`.
    try {
      appendAgentRun({
        ownerId: user.id,
        model,
        funded: resolved.funded,
        totalTokens: result.totalTokens,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
        steps: result.steps,
        toolCalls: result.toolCalls,
        ok: result.ok,
        timelineId: data.timelineId,
      })
    } catch (err) {
      console.error('[meter] failed to append agent_run ledger row', err)
    }

    captureServer(user.id, 'agent_run', {
      ok: result.ok,
      timeline_id: data.timelineId,
      model,
      funded: resolved.funded,
      // M.3: the seat-model vocab (M.5 ledger + M.6 per-user table) so engagement
      // analysis splits by SKU. operator-funded inference = the managed seat; a
      // user's own key = the BYO seat.
      segment: resolved.funded === 'operator' ? 'managed' : 'byo',
      steps: result.steps,
      tool_calls: result.toolCalls,
      patches: result.patchIds.length,
      total_tokens: result.totalTokens,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      ...(result.costUsd != null ? { cost_usd: result.costUsd } : {}),
      duration_ms: Math.round(performance.now() - t0),
      ...(result.error ? { error: result.error } : {}),
    })
    return result
  })
