// --- Right-docked panel widths (localStorage) -----------------------------
// The story reader holds the flush-right slot and the detail panel opens to its
// LEFT, so the two form one dock column at the right edge of the canvas; both are
// user-resizable. Width is a global UI preference (the same across timelines),
// stored under one key. Clamped so they can't collapse to nothing or crowd the
// canvas off-screen.

export const DETAIL_WIDTH = { def: 340, min: 280, max: 560 }
export const STORY_WIDTH = { def: 380, min: 300, max: 640 }

// Gutters + the gap between the two docks (16 each). Part of the footprint any
// combined clamp has to account for.
export const DOCK_CHROME = 48

// Never let the docks eat more than this share of the canvas. Both panels open at
// their maxima is 1200px + chrome, which left nothing usable on a 1440px screen —
// tolerable when both-open was rare, and the DEFAULT state now that the panel is
// the story's companion.
const MAX_DOCK_SHARE = 0.62

export type PanelWidths = { detail: number; story: number }

const KEY = 'synek:panel-widths'
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

export const clampDetail = (v: number) => clamp(v, DETAIL_WIDTH.min, DETAIL_WIDTH.max)
export const clampStory = (v: number) => clamp(v, STORY_WIDTH.min, STORY_WIDTH.max)

// Clamp ONE panel against the space the other already occupies. `available` is the
// measured canvas width; pass 0/undefined when it can't be measured (SSR) and the
// per-panel clamp applies alone. Each panel keeps its own minimum, so on a canvas
// too narrow for both the caller falls back to the stacked layout rather than
// shrinking them into unreadability.
export function clampAgainstPeer(
  value: number,
  peerWidth: number,
  available: number | undefined,
  bounds: { min: number; max: number },
): number {
  const base = clamp(value, bounds.min, bounds.max)
  if (!available || available <= 0) return base
  const budget = available * MAX_DOCK_SHARE - peerWidth - DOCK_CHROME
  if (budget <= bounds.min) return bounds.min
  return Math.min(base, Math.round(budget))
}

export function loadPanelWidths(): PanelWidths {
  const fallback = { detail: DETAIL_WIDTH.def, story: STORY_WIDTH.def }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<PanelWidths>
    return {
      detail: typeof p.detail === 'number' ? clampDetail(p.detail) : DETAIL_WIDTH.def,
      story: typeof p.story === 'number' ? clampStory(p.story) : STORY_WIDTH.def,
    }
  } catch {
    return fallback
  }
}

export function savePanelWidths(w: PanelWidths): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(w))
  } catch {
    // ignore quota / disabled storage
  }
}
