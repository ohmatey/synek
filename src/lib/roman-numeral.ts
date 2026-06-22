// Chapter numbers as Roman numerals — the reader-facing "book" language on the
// public season page. Caps at XX (20): beyond that Roman numerals lose legibility,
// so fall back to Arabic. The in-app (creator) surface uses Arabic throughout.
const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

export function toRomanNumeral(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n > 20) return String(n)
  let out = ''
  let rem = Math.floor(n)
  for (const [value, symbol] of ROMAN) {
    while (rem >= value) {
      out += symbol
      rem -= value
    }
  }
  return out
}
