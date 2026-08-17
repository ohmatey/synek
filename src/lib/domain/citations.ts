import type { CitationSourceType } from './types'

// Shared citation presentation vocabulary.
//
// Citations render in four places (node panel read + edit, the in-app story
// reader, the public story reader) that had drifted into three unrelated CSS
// families and three different fallback labels. These helpers are the single
// source of truth so a citation reads the same wherever it appears.

// `sourceType` has been plumbed end to end since S2 (MCP add_node/update_node,
// write_story, the artifact projection, the layout report's source registry) and
// rendered NOWHERE. The comment on the type says it exists so a reader can
// "distinguish Tacitus from a 2014 trade book at a glance"; these are the labels
// that finally do that.
export const SOURCE_TYPE_LABEL: Record<CitationSourceType, string> = {
  primary: 'Primary',
  scholarship: 'Scholarship',
  data: 'Data',
  press: 'Press',
}

// Provenance distance, carried only by artifact-backed story citations.
export const RELIABILITY_LABEL: Record<string, string> = {
  primary: 'Contemporaneous',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
}

export const UNTITLED_SOURCE = 'Untitled source'

// Host + trimmed path, for the muted line under a citation title. Returns null
// for anything unparseable so callers can omit the line rather than print junk.
export function displayUrl(url: string | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return `${u.host}${path}${u.search ? '?…' : ''}`
  } catch {
    // Not absolute (or not a URL at all): strip a scheme if present and show it raw.
    return raw.replace(/^https?:\/\//, '').replace(/\/$/, '') || null
  }
}

// A citation is openable only when it carries a URL we can actually navigate to.
// A title-only citation (a print source) is legitimate and renders without a link
// rather than as a dead affordance.
export function citationHref(url: string | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : null
}
