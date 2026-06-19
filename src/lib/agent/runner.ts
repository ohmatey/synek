import { z } from 'zod'
import { toolRegistry, type ToolCtx, type ToolDef } from '~/lib/mcp/registry'
import { BASE_URL } from '~/lib/auth'
import { defaultModel, agentBudgets, type AgentBudgets } from './config'
import { agentSystemPrompt } from './system-prompt'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// OpenAI-style function tool definition derived from a registry tool's Zod schema.
type FunctionDef = {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

// Build the function defs once (z.toJSONSchema over each tool's input shape). The
// opSchema discriminated union becomes anyOf+const — built here so a schema bug
// surfaces at load, not mid-run.
let fnDefsCache: FunctionDef[] | null = null
function functionDefs(): FunctionDef[] {
  if (fnDefsCache) return fnDefsCache
  fnDefsCache = toolRegistry.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(z.object(t.inputSchema), { target: 'draft-07' }),
    },
  }))
  return fnDefsCache
}

const byName = new Map<string, ToolDef>(toolRegistry.map((t) => [t.name, t]))

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

export type AgentRunResult = {
  ok: boolean
  summary: string
  patchIds: string[]
  steps: number
  toolCalls: number
  // Usage surfaced for the metering ledger (METER). total = prompt + completion as
  // reported by OpenRouter; costUsd is the provider's actual credit cost for the run
  // (present only when the API returns it — see `usage: { include: true }` below).
  totalTokens: number
  promptTokens: number
  completionTokens: number
  costUsd?: number
  error?: string
}

// Run one in-process agent turn against the shared tool registry via OpenRouter.
// Handlers run in-process, so apply_patch -> commitPatch -> SSE streams to the open
// canvas with no extra wiring. Bounded by budgets (the operator pays).
export async function runAgentLoop(input: {
  prompt: string
  // The resolved OpenRouter key (per-user or operator env) — passed in by the
  // caller (src/lib/server/agent.ts), never read from env here.
  apiKey: string
  model?: string
  ctx: ToolCtx
  budgets?: AgentBudgets
}): Promise<AgentRunResult> {
  const key = input.apiKey
  if (!key)
    return { ok: false, summary: '', patchIds: [], steps: 0, toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, error: 'agent not configured' }

  const model = input.model?.trim() || defaultModel()
  const budgets = input.budgets ?? agentBudgets()
  const tools = functionDefs()

  const messages: ChatMessage[] = [
    { role: 'system', content: agentSystemPrompt() },
    { role: 'user', content: input.prompt },
  ]

  const patchIds: string[] = []
  let toolCalls = 0
  let tokensUsed = 0
  let promptTokens = 0
  let completionTokens = 0
  let costUsd = 0
  let summary = ''

  // Single exit builder — every return spreads the running token/cost accumulators
  // so no early-out path forgets them (the ledger needs usage on success AND error).
  const done = (p: { ok: boolean; steps: number; error?: string }): AgentRunResult => ({
    ok: p.ok,
    summary,
    patchIds,
    steps: p.steps,
    toolCalls,
    totalTokens: tokensUsed,
    promptTokens,
    completionTokens,
    ...(costUsd > 0 ? { costUsd } : {}),
    ...(p.error ? { error: p.error } : {}),
  })

  for (let step = 0; step < budgets.maxSteps; step++) {
    if (tokensUsed >= budgets.maxTokens) {
      return done({ ok: false, steps: step, error: `token budget exhausted (${tokensUsed}/${budgets.maxTokens})` })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budgets.timeoutMs)
    let data: any
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': BASE_URL,
          'X-Title': 'Synek',
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: 'auto',
          max_tokens: budgets.requestMaxTokens,
          // Ask OpenRouter to return the actual credit cost per response so we can
          // ledger real COGS (usage.cost) rather than estimate it (METER).
          usage: { include: true },
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const friendly =
          res.status === 404 || res.status === 400
            ? `model "${model}" rejected the request (it may not support tool calling) — try another model`
            : `OpenRouter error ${res.status}`
        return done({ ok: false, steps: step, error: `${friendly}${body ? `: ${body.slice(0, 300)}` : ''}` })
      }
      data = await res.json()
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return done({
        ok: false,
        steps: step,
        error: aborted ? `request timed out after ${budgets.timeoutMs}ms` : err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timer)
    }

    const usage = data?.usage
    tokensUsed += Number(usage?.total_tokens) || 0
    promptTokens += Number(usage?.prompt_tokens) || 0
    completionTokens += Number(usage?.completion_tokens) || 0
    costUsd += Number(usage?.cost) || 0
    const msg = data?.choices?.[0]?.message
    if (!msg) return done({ ok: false, steps: step, error: 'empty response from model' })

    const calls: ToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    // Echo the assistant turn back (tool_calls and all) before answering them.
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) })

    if (!calls.length) {
      summary = typeof msg.content === 'string' ? msg.content : summary
      return done({ ok: true, steps: step + 1 })
    }

    for (const call of calls) {
      toolCalls++
      const content = await executeToolCall(call, input.ctx, patchIds)
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }

  // Hit the step cap with tool calls still pending — stop, report what we did.
  return done({ ok: false, steps: budgets.maxSteps, error: `reached the step limit (${budgets.maxSteps}) before finishing` })
}

// Execute one tool call against the registry; always returns a JSON string for the
// tool message (errors included, so the model can self-correct rather than crash).
async function executeToolCall(call: ToolCall, ctx: ToolCtx, patchIds: string[]): Promise<string> {
  const tool = byName.get(call.function?.name)
  if (!tool) return JSON.stringify({ error: `unknown tool "${call.function?.name}"` })

  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: 'arguments were not valid JSON — resend valid JSON for this tool' })
  }

  const parsed = z.object(tool.inputSchema).safeParse(raw)
  if (!parsed.success) {
    return JSON.stringify({ error: 'invalid arguments', issues: parsed.error.issues.slice(0, 8) })
  }

  try {
    const result = await tool.handler(parsed.data, ctx)
    if (tool.name === 'apply_patch' && result && typeof result === 'object' && 'patchId' in result) {
      const id = (result as { patchId?: unknown }).patchId
      if (typeof id === 'string') patchIds.push(id)
    }
    return JSON.stringify(result)
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}
