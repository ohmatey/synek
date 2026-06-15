import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getTimelineMeta } from '~/lib/db/graph'
import { getCurrentUser, requireUser } from '~/lib/auth/session'
import { getUserSettingsRow } from '~/lib/db/user-settings'
import { decryptSecret } from '~/lib/crypto/secrets'
import { makeRequireOwnedProject } from '~/lib/db/projects'
import { makeRequireOwned, type ToolCtx } from '~/lib/mcp/registry'
import { openRouterKey, defaultModel } from '~/lib/agent/config'
import { runAgentLoop, type AgentRunResult } from '~/lib/agent/runner'
import { captureServer } from '~/lib/posthog/server'

// The in-app agent's two server entry points. getAgentConfig tells the client
// whether to offer "Run"; runAgent executes a prompt server-side against the SAME
// tools the MCP server exposes, committing real Patches that stream to the open
// canvas via the existing SSE path.
//
// Phase 2: the OpenRouter key is resolved PER USER — the user's own stored key
// (decrypted) first, then the operator env key as a self-host fallback. The key
// never crosses to the client (getAgentConfig returns only flags).

function resolveKey(userId: string): string | null {
  const row = getUserSettingsRow(userId)
  if (row?.openRouterKeyEnc) {
    try {
      return decryptSecret(row.openRouterKeyEnc)
    } catch {
      /* corrupt blob or rotated SYNEK_SECRETS_KEY — fall through to the env key */
    }
  }
  return openRouterKey() ?? null
}

function resolveModel(userId: string): string {
  return getUserSettingsRow(userId)?.agentModel?.trim() || defaultModel()
}

const FAIL = (error: string): AgentRunResult => ({ ok: false, summary: '', patchIds: [], steps: 0, toolCalls: 0, error })

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
    const key = resolveKey(user.id)
    if (!key) return FAIL('No OpenRouter key configured — add yours under API keys to run.')
    const meta = getTimelineMeta(data.timelineId)
    if (!meta || meta.ownerId !== user.id) return FAIL('forbidden: not your timeline')

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
    const result = await runAgentLoop({ prompt: data.prompt, model, apiKey: key, ctx })
    captureServer(user.id, 'agent_run', {
      ok: result.ok,
      timeline_id: data.timelineId,
      model,
      steps: result.steps,
      tool_calls: result.toolCalls,
      patches: result.patchIds.length,
      duration_ms: Math.round(performance.now() - t0),
      ...(result.error ? { error: result.error } : {}),
    })
    return result
  })
