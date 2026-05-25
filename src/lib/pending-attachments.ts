import type { FileUIPart } from 'ai'

// Files attached on the home prompt bar can't ride the `?prompt=` URL, so the
// converted parts are stashed here (in memory, client-only) keyed by the new
// timeline id, and consumed once by the timeline's auto-send. Ephemeral by
// design — a hard page reload drops them.
const store = new Map<string, FileUIPart[]>()

export function stashAttachments(timelineId: string, parts: FileUIPart[]): void {
  if (parts.length) store.set(timelineId, parts)
}

export function takeAttachments(timelineId: string): FileUIPart[] | undefined {
  const parts = store.get(timelineId)
  store.delete(timelineId)
  return parts
}
