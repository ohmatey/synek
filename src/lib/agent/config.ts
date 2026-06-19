// The in-app agent runner — OPTIONAL and OFF by default. It re-introduces an
// in-app model, but only as a *progressive enhancement*: with no OpenRouter key
// configured, Synek stays a pure viewer + MCP server and the prompt dialogs only
// copy a prompt. Configure a key (self-hoster's own, or a hosted operator's) and
// those same dialogs gain a "Run" that executes server-side. Env is read at call
// time, key-presence gates the feature — same shape as posthog/server.ts and
// telemetry/heartbeat.ts.

// The OpenRouter API key — SERVER-SIDE ONLY. Never sent to the client; getAgentConfig
// exposes only { enabled, defaultModel }.
export function openRouterKey(): string | undefined {
  const k = process.env.OPENROUTER_API_KEY?.trim()
  return k ? k : undefined
}

// The feature is on iff a key is configured.
export function agentEnabled(): boolean {
  return !!openRouterKey()
}

// The default OpenRouter model id (a provider/model slug, e.g.
// "anthropic/claude-sonnet-4.6"). Users can override per-run; this is the fallback.
// It MUST be a tool-calling-capable model.
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4.6'
export function defaultModel(): string {
  return process.env.SYNEK_AGENT_MODEL?.trim() || FALLBACK_MODEL
}

// Cost/safety caps — the operator (or self-hoster) pays for runs, so every loop is
// bounded. All env-overridable.
export type AgentBudgets = {
  maxSteps: number // max assistant<->tool round-trips before we stop
  maxTokens: number // cumulative total_tokens budget across the run
  requestMaxTokens: number // per-request max_tokens
  timeoutMs: number // per-request abort timeout
}

const numEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function agentBudgets(): AgentBudgets {
  return {
    maxSteps: numEnv('SYNEK_AGENT_MAX_STEPS', 12),
    maxTokens: numEnv('SYNEK_AGENT_MAX_TOKENS', 120_000),
    requestMaxTokens: numEnv('SYNEK_AGENT_REQUEST_MAX_TOKENS', 4096),
    timeoutMs: numEnv('SYNEK_AGENT_TIMEOUT_MS', 60_000),
  }
}

// METER safety cap — the OPERATOR-funded daily ceiling per user (a rolling 24h
// window). UNSET or 0 → null (unlimited), which preserves the local-first default:
// a download/self-host sets neither and stays uncapped. A cloud deploy sets these via
// env (fly.toml) so only the hosted instance is capped. Read at call time, like the
// budgets above. BYO-key users are exempt (the caller enforces that).
export type AgentQuota = { dailyRuns: number | null; dailyTokens: number | null }

const capEnv = (name: string): number | null => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function agentQuota(): AgentQuota {
  return {
    dailyRuns: capEnv('SYNEK_AGENT_DAILY_RUNS'),
    dailyTokens: capEnv('SYNEK_AGENT_DAILY_TOKENS'),
  }
}
