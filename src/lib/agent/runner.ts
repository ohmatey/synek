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
  if (!key) return { ok: false, summary: '', patchIds: [], steps: 0, toolCalls: 0, error: 'agent not configured' }

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
  let summary = ''

  for (let step = 0; step < budgets.maxSteps; step++) {
    if (tokensUsed >= budgets.maxTokens) {
      return {
        ok: false,
        summary,
        patchIds,
        steps: step,
        toolCalls,
        error: `token budget exhausted (${tokensUsed}/${budgets.maxTokens})`,
      }
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
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const friendly =
          res.status === 404 || res.status === 400
            ? `model "${model}" rejected the request (it may not support tool calling) — try another model`
            : `OpenRouter error ${res.status}`
        return { ok: false, summary, patchIds, steps: step, toolCalls, error: `${friendly}${body ? `: ${body.slice(0, 300)}` : ''}` }
      }
      data = await res.json()
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false,
        summary,
        patchIds,
        steps: step,
        toolCalls,
        error: aborted ? `request timed out after ${budgets.timeoutMs}ms` : err instanceof Error ? err.message : String(err),
      }
    } finally {
      clearTimeout(timer)
    }

    tokensUsed += Number(data?.usage?.total_tokens) || 0
    const msg = data?.choices?.[0]?.message
    if (!msg) return { ok: false, summary, patchIds, steps: step, toolCalls, error: 'empty response from model' }

    const calls: ToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    // Echo the assistant turn back (tool_calls and all) before answering them.
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) })

    if (!calls.length) {
      summary = typeof msg.content === 'string' ? msg.content : summary
      return { ok: true, summary, patchIds, steps: step + 1, toolCalls }
    }

    for (const call of calls) {
      toolCalls++
      const content = await executeToolCall(call, input.ctx, patchIds)
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }

  // Hit the step cap with tool calls still pending — stop, report what we did.
  return {
    ok: false,
    summary,
    patchIds,
    steps: budgets.maxSteps,
    toolCalls,
    error: `reached the step limit (${budgets.maxSteps}) before finishing`,
  }
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
