/// <reference types="vite/client" />
import posthog from 'posthog-js'

// Browser product analytics — the SINGLE chokepoint. Everything no-ops unless
// (a) a key is configured at build time AND (b) the user hasn't opted out.
//
// Posture: opt-OUT, default ON (per product decision). Analytics runs whenever a
// VITE_POSTHOG_KEY is present; the user can switch it off in /account. A fresh
// checkout with no key sends nothing at all (operator-gated by key presence), so
// the local-first promise still holds for anyone who doesn't configure a key.

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com'

// Source of truth for the user's choice. We store only the explicit opt-OUT so the
// default (no value) reads as ON. Mirrored into posthog's own opt-state on toggle.
const OPT_OUT_KEY = 'synek_analytics_opt_out'

let started = false

/** True only when the user has explicitly opted out (default: opted in). */
export function optedOut(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(OPT_OUT_KEY) === 'true'
}

// Capture fires only when there's a key, we're in the browser, and not opted out.
function enabled(): boolean {
  return typeof window !== 'undefined' && !!KEY && !optedOut()
}

/** Initialize the browser client once. No-op without a key, on the server, or when opted out. */
export function initPostHog(): void {
  if (started || !enabled()) return
  posthog.init(KEY!, {
    api_host: HOST,
    // We send $pageview manually on TanStack Router resolve (see Analytics.tsx),
    // and keep the event set curated — both flags avoid double-counting SPA navs.
    capture_pageview: false,
    autocapture: false,
    capture_pageleave: true,
    persistence: 'localStorage',
    debug: typeof window !== 'undefined' && window.location.search.includes('phdebug'),
  })
  started = true
}

/** Flip the opt-out flag and bring posthog's own capture state in line. */
export function setOptOut(off: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OPT_OUT_KEY, String(off))
  if (off) {
    if (started) posthog.opt_out_capturing()
  } else {
    initPostHog()
    if (started) posthog.opt_in_capturing()
  }
}

export function identifyUser(id: string, email?: string): void {
  if (!enabled() || !started) return
  posthog.identify(id, email ? { email } : undefined)
}

export function resetUser(): void {
  if (!started) return
  posthog.reset()
}

// The curated, high-signal event set. The copy-a-prompt-into-Claude loop is the
// activation signal for this MCP-native product, so those events lead.
export type ClientEvent =
  | 'timeline_created'
  | 'build_prompt_copied'
  | 'improve_prompt_copied'
  | 'talk_to_prompt_copied'
  | 'story_prompt_copied'
  | 'command_palette_used'
  | 'story_started'
  | 'story_completed'
  | 'node_edited'
  | 'export_performed'
  | 'share_toggled'

/** Typed, gated capture. Safe to call from anywhere — no-ops until init + opt-in. */
export function capture(event: ClientEvent | '$pageview', props?: Record<string, unknown>): void {
  if (!enabled() || !started) return
  posthog.capture(event, props)
}
