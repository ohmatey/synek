import { PostHog } from 'posthog-node'
import { isAnalyticsOptedOut } from '~/lib/db/user-settings'

// Server-side product analytics for the MCP layer — the highest-value KPIs, since
// the app holds no in-app AI and everything the model builds flows through MCP
// tools. A lazy singleton that no-ops without a key (operator opt-in = key
// presence). The module survives across the stateless HTTP requests, so a single
// client + per-request flush is the reliable shape (see flushAnalytics).

const KEY = process.env.POSTHOG_API_KEY
const HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'

let client: PostHog | null = null

function get(): PostHog | null {
  if (!KEY) return null
  if (!client) client = new PostHog(KEY, { host: HOST, flushAt: 20, flushInterval: 10_000 })
  return client
}

/**
 * Whether `distinctId` (a Better Auth user id) has left server analytics on. The
 * /account switch persists to user_settings, so this is the same choice the browser
 * honours. Fails CLOSED: if the lookup throws we send nothing rather than guess.
 */
export function serverAnalyticsAllowed(distinctId: string): boolean {
  try {
    return !isAnalyticsOptedOut(distinctId)
  } catch {
    return false
  }
}

/**
 * Enqueue an event. Wrapped so analytics can NEVER break a tool call. Every server
 * emit funnels through here, so the per-user opt-out is enforced in this one place.
 */
export function captureServer(distinctId: string, event: string, properties: Record<string, unknown>): void {
  const c = get()
  if (!c) return
  if (!serverAnalyticsAllowed(distinctId)) return
  try {
    c.capture({ distinctId, event, properties })
  } catch {
    /* analytics must never throw into a tool handler */
  }
}

/**
 * Flush pending events. LOAD-BEARING on the stateless HTTP transport: the request
 * scope ends after the response returns, so without flushing here a just-enqueued
 * event would buffer in the surviving singleton and could be lost on idle/crash.
 */
export async function flushAnalytics(): Promise<void> {
  if (!client) return
  try {
    await client.flush()
  } catch {
    /* ignore */
  }
}

/** Flush + stop the client. For the long-lived stdio process on shutdown. */
export async function shutdownAnalytics(): Promise<void> {
  if (!client) return
  try {
    await client.shutdown()
  } catch {
    /* ignore */
  }
}
