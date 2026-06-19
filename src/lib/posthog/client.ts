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
  // M.1 activation funnel (docs/product/prd/m1-activation-funnel.md). The ordered
  // steps are signup → key_connected → timeline_created → story_written → story_shared.
  //   signup        { source: 'email', referrer? }
  //   key_connected { provider: 'openrouter' | 'mcp_bearer', segment: 'byo' }  — the
  //     PIVOTAL drop-off. 'openrouter' = saved an in-app key (this client emit);
  //     'mcp_bearer' = first authenticated MCP call (emitted server-side in mcp/server.ts),
  //     so the BYO-own-client cohort isn't an invisible gap between signup and first build.
  // `timeline_created`/`story_shared`/`public_story_opened` are declared below;
  // `story_written` is emitted server-side (MCP/agent paths) via captureServer, so it
  // is intentionally not in this browser union (no direct UI write path exists).
  | 'signup'
  | 'key_connected'
  // `timeline_created` now carries a `source: 'ui' | 'mcp' | 'agent'` prop so the
  // one funnel step spans all three create paths.
  | 'timeline_created'
  | 'build_prompt_copied'
  // One event for every canvas "verb" (NEXT.5), keyed by `verb_id` + `surface` in
  // props, so copy-rates self-prioritize the catalogue (bet B5) in one query.
  | 'verb_prompt_copied'
  // The progressive-enhancement twin of verb_prompt_copied: the user RAN the same
  // prompt in-app (the OpenRouter agent) instead of copying it into their own
  // Claude. Props mirror the copy event (verb_id, surface, …) + { model, ok }.
  | 'verb_prompt_run'
  // Impression for the Tier-2 canvas invitations (gap/lane/era ghosts), so
  // `verb_prompt_copied` for fill-gap/extend-lane/populate-era has a denominator —
  // copy-RATE, not just count (bet B5). Props carry per-variant counts.
  | 'invitation_shown'
  | 'story_prompt_copied'
  | 'command_palette_used'
  // Stories lens (docs/product/prd/stories-view.md). Navigation signal for bet B3:
  // `story_view_opened { timeline_id }` is the denominator for story plays that
  // enter from the Stories list (vs. a node panel). Plays/completions still ride
  // `story_started`/`story_completed` from the reader.
  | 'story_view_opened'
  | 'story_started'
  | 'story_completed'
  // Sharable stories (bet: sharing drives acquisition). `story_shared` fires when an
  // owner publishes a story's public /s/$slug link from the reader; `public_story_opened`
  // when the public page itself is played. Props documented at the call sites.
  | 'story_shared'
  | 'public_story_opened'
  // M.3 engagement depth (docs/product/prd/understand-app.md §M.3). Fires once per
  // live per-beat widget that actually renders on the public reader — the value
  // signal for the publishing thesis. Props: `{ kind: 'timeline' | 'globe' | 'entity' }`.
  | 'widget_rendered'
  | 'node_edited'
  | 'export_performed'
  | 'share_toggled'
  // Globe lens (docs/product/prd/globe-lens.md). The hero is `globe_playback_started`
  // over `globe_lens_opened` (did opening the lens lead to playing). Props (untyped at
  // the call site, documented here):
  //   globe_lens_opened       { timeline_id, node_count, coordinated_count, coverage_pct }
  //   globe_playback_started  { timeline_id, speed }
  //   globe_scrubbed          { timeline_id }
  //   globe_marker_clicked    { timeline_id, node_id, node_type }
  //   globe_lens_closed       { timeline_id, session_duration_ms, played }
  //   globe_backfill_prompt_copied { timeline_id, uncoordinated_count?, surface? }  (fired via the PromptSpec copy seam)
  //   globe_zoomed            { timeline_id, via: 'wheel' | 'button' }  (GS2; debounced per wheel gesture)
  | 'globe_lens_opened'
  | 'globe_playback_started'
  | 'globe_scrubbed'
  | 'globe_marker_clicked'
  | 'globe_lens_closed'
  | 'globe_backfill_prompt_copied'
  | 'globe_zoomed'
  // Cinematic stories-first home (docs/product/prd/cinematic-home.md §8). The home
  // becomes a measurable on-ramp into the reader (B3) + a new share entry point (B6).
  //   home_hero_play_clicked    { project_id?, story_id }
  //   home_story_card_clicked   { project_id?, story_id }
  //   home_share_clicked        { project_id?, story_id, source: 'hero' | 'card' }
  //   home_project_filter_selected { project_id }
  //   home_move_to_project      { from_project_id?, to_project_id }
  //   home_new_project_created  { project_id }
  | 'home_hero_play_clicked'
  | 'home_story_card_clicked'
  | 'home_story_play_clicked'
  | 'home_share_clicked'
  | 'home_project_filter_selected'
  | 'home_move_to_project'
  | 'home_new_project_created'

/** Typed, gated capture. Safe to call from anywhere — no-ops until init + opt-in. */
export function capture(event: ClientEvent | '$pageview', props?: Record<string, unknown>): void {
  if (!enabled() || !started) return
  posthog.capture(event, props)
}
