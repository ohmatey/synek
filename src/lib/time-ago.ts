// Relative "X ago" label. Shared by the public story reader, the series jacket meta
// line, and the spine recency badge. Uses Date.now(), so it's client-time: callers
// that SSR should pair it with an absolute fallback for first paint and set the
// relative value after mount (see PublicStoryReader) to avoid a hydration mismatch.
export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
