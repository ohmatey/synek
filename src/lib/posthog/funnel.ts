import { captureServer } from './server'

// M.1 activation funnel (docs/product/prd/m1-activation-funnel.md). The browser
// emits `timeline_created` / `story_written`-shaped signals on the UI path; this
// mirrors the SAME canonical events server-side for the MCP and in-app-agent paths,
// so an MCP- or agent-driven create lands in the one activation funnel instead of
// hiding inside the generic `mcp_tool_called` event. Kept OUT of the registry
// handlers (they stay transport-agnostic) and called from each transport wrapper.
//
// `raw` is the tool handler's plain return object — the MCP transport unwraps its
// `{ content:[{text}] }` envelope first; the agent runner passes the object directly.
// Best-effort and shape-guarded: captureServer already swallows errors and no-ops
// without a key, so this can never break a tool call.
export function captureToolFunnelEvent(
  ownerId: string,
  tool: string,
  args: any,
  raw: any,
  source: 'mcp' | 'agent',
): void {
  if (tool === 'create_timeline') {
    const id = raw?.id
    if (typeof id === 'string') captureServer(ownerId, 'timeline_created', { timeline_id: id, source })
    return
  }
  if (tool === 'write_story') {
    const storyId = raw?.storyId
    if (typeof storyId !== 'string') return
    captureServer(ownerId, 'story_written', {
      story_id: storyId,
      // write_story keys off the moment (node), not a timeline id — carry that.
      moment_id: typeof args?.momentId === 'string' ? args.momentId : undefined,
      beats: Array.isArray(args?.segments) ? args.segments.length : 0,
      // A storyId passed in by the caller means this is an in-place update, not a
      // first write — only the first write is a funnel-step "story written".
      is_update: !!args?.storyId,
      source,
    })
  }
}
