// --- Right-docked panel widths (localStorage) -----------------------------
// The detail panel and the story reader dock as a column at the right edge of
// the canvas; both are user-resizable. Width is a global UI preference (the
// same across timelines), stored under one key. Clamped so they can't collapse
// to nothing or crowd the canvas off-screen.

export const DETAIL_WIDTH = { def: 340, min: 280, max: 560 }
export const STORY_WIDTH = { def: 380, min: 300, max: 640 }

export type PanelWidths = { detail: number; story: number }

const KEY = 'synek:panel-widths'
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

export const clampDetail = (v: number) => clamp(v, DETAIL_WIDTH.min, DETAIL_WIDTH.max)
export const clampStory = (v: number) => clamp(v, STORY_WIDTH.min, STORY_WIDTH.max)

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
