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
