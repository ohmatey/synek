import type { Precision } from './types'

export type ParsedDate = { instant: number; precision: Precision }

// Build an epoch-ms instant for any year (incl. ancient/negative), sidestepping
// Date.UTC's 0–99 → 1900s quirk by setting the full year explicitly.
function instantOf(year: number, month = 0, day = 1): number {
  const d = new Date(Date.UTC(2000, month, day))
  d.setUTCFullYear(year)
  return d.getTime()
}

// Parse a fuzzy/historical date into a sortable instant + precision.
// Handles: "2015", "2015-06", "2015-06-15", "2015/06", "Q3 2008", "2008 Q3",
// "49 BCE"/"49 BC", "1200 CE"/"AD 1200". Falls back to the first number, else year 0.
export function parseDate(input: string): ParsedDate {
  const s = (input ?? '').trim().toLowerCase()

  // BCE / BC → negative year (1 BCE = year 0 astronomically)
  const bce = s.match(/(\d{1,7})\s*(?:bce|bc)\b/)
  if (bce) return { instant: instantOf(-(parseInt(bce[1]!, 10) - 1)), precision: 'year' }

  // Quarter: "q3 2008" or "2008 q3"
  const q = s.match(/q([1-4])\s*(\d{3,4})|(\d{3,4})\s*q([1-4])/)
  if (q) {
    const quarter = parseInt(q[1] ?? q[4]!, 10)
    const year = parseInt(q[2] ?? q[3]!, 10)
    return { instant: instantOf(year, (quarter - 1) * 3, 1), precision: 'quarter' }
  }

  // ISO-ish (dash or slash): YYYY-MM-DD, then YYYY-MM
  const ymd = s.match(/(-?\d{1,7})[-/](\d{1,2})[-/](\d{1,2})/)
  if (ymd) return { instant: instantOf(+ymd[1]!, +ymd[2]! - 1, +ymd[3]!), precision: 'day' }
  const ym = s.match(/(-?\d{1,7})[-/](\d{1,2})/)
  if (ym) return { instant: instantOf(+ym[1]!, +ym[2]! - 1, 1), precision: 'month' }

  // Bare year (CE/AD optional and ignored)
  const yr = s.match(/(-?\d{1,7})/)
  if (yr) return { instant: instantOf(+yr[1]!), precision: 'year' }

  return { instant: instantOf(0), precision: 'year' }
}

// Render an instant + precision back to a human label for the canvas.
export function formatInstant(instant: number, precision: Precision): string {
  const d = new Date(instant)
  const y = d.getUTCFullYear()
  const year = y <= 0 ? `${-y + 1} BCE` : `${y}`
  if (precision === 'year') return year
  if (precision === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${year}`
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  if (precision === 'month') return `${mon} ${year}`
  return `${mon} ${d.getUTCDate()}, ${year}`
}

function durationUnit(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// Human duration between two instants, in the largest unit that reads naturally.
// BCE-safe — getUTCFullYear() works on negative-epoch instants, same as
// formatInstant. Year-precision spans always read in years (the months/days a
// year-precision instant implies are noise). Returns null when there is nothing
// meaningful to say (same instant, or end before start).
function formatDurationBetween(start: number, end: number, precision: Precision): string | null {
  if (end <= start) return null
  const s = new Date(start)
  const e = new Date(end)
  const years = e.getUTCFullYear() - s.getUTCFullYear()
  if (precision === 'year') return years > 0 ? durationUnit(years, 'year') : null
  const months = years * 12 + (e.getUTCMonth() - s.getUTCMonth())
  if (months >= 24) return durationUnit(Math.round(months / 12), 'year')
  if (months >= 2) return durationUnit(months, 'month')
  const days = Math.round((end - start) / 86_400_000)
  return days > 0 ? durationUnit(days, 'day') : null
}

// One readable line for a node's time: "Sep 15, 2008" for an event,
// "Jun 1997 – Jul 2007 · 10 years" for a closed span, "Jun 1997 – ongoing" for
// an open one. BCE works throughout ("49 BCE – 31 BCE · 18 years").
export function formatInstantRange(
  start: number,
  end: number | null,
  precision: Precision,
  hasSpan: boolean,
): string {
  const from = formatInstant(start, precision)
  if (!hasSpan) return from
  if (end == null) return `${from} – ongoing`
  const to = formatInstant(end, precision)
  const duration = formatDurationBetween(start, end, precision)
  return duration ? `${from} – ${to} · ${duration}` : `${from} – ${to}`
}

// A faint, theme-aware background tint for a period, derived from its date range
// so the "mood of the age" reads at a glance. Deterministic: the period's
// midpoint century maps via the golden angle (137.5°) to a well-separated hue,
// mixed 12% over the `--color-bg-overlay` surface token (the same recipe as the
// concept chip) so it stays subtle and follows light/dark automatically.
// BCE-safe — `getUTCFullYear()` on the negative-epoch midpoint, like formatInstant.
export function eraTint(startInstant: number, endInstant: number | null): string {
  const mid = startInstant + ((endInstant ?? startInstant) - startInstant) / 2
  const year = new Date(mid).getUTCFullYear()
  const century = Math.floor(year / 100)
  const hue = (((century * 137.5) % 360) + 360) % 360
  return `color-mix(in oklab, hsl(${hue} 55% 55%) 12%, var(--color-bg-overlay))`
}
